const Queue = require('../models/Queue');
const Store = require('../models/Store');
const axios = require('axios');

const DEFAULT_NO_SHOW_MINUTES = parseInt(process.env.NO_SHOW_MINUTES || '30', 10);
let noShowEnabled = process.env.NO_SHOW_ENABLED === 'true';
const ARIMA_SERVICE_URL = process.env.ARIMA_SERVICE_URL || 'http://localhost:5000';

const resolveActualTime = (q) => (q.actualServiceTime ?? q.actualWaitTime);
const resolveEstimatedTime = (q) => (q.estimatedServiceTime ?? q.estimatedWaitTime);

// 🔄 HELPER FUNCTION: Recalculate wait times when someone leaves
async function recalculateWaitTimes(storeId, io) {
  try {
    const store = await Store.findById(storeId);
    
    // Get all waiting people, sorted by who joined first
    const waitingQueues = await Queue.find({
      store: storeId,
      status: 'waiting'
    }).sort('joinedAt');

    const perPersonTime = await getMlPerPersonTime(store, waitingQueues.length);

    for (let i = 0; i < waitingQueues.length; i++) {
      const peopleAhead = i; // Position in queue (0 = first, 1 = second, etc.)
      const newWaitTime = Math.round((peopleAhead * perPersonTime) * 100) / 100;

      if (waitingQueues[i].estimatedWaitTime !== newWaitTime) {
        const previousEstimate = waitingQueues[i].estimatedWaitTime;
        waitingQueues[i].estimatedWaitTime = newWaitTime;
        waitingQueues[i].waitTimeUpdatedAt = new Date();
        await waitingQueues[i].save();

        if (io) {
          io.to(`queue-${waitingQueues[i]._id}`).emit('waitTimeUpdate', {
            queueId: waitingQueues[i]._id,
            estimatedWaitTime: newWaitTime,
            previousEstimate,
            delta: previousEstimate != null ? newWaitTime - previousEstimate : 0,
            positionInQueue: i + 1,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // 📡 Send update to everyone watching this store
    if (io) {
      io.to(`store-${storeId}`).emit('queueUpdate', {
        storeId,
        currentQueueSize: store.currentQueueSize,
        waitingCount: waitingQueues.length,
        timestamp: new Date().toISOString()
      });
    }

    return waitingQueues.length;
  } catch (error) {
    console.error('Error recalculating wait times:', error);
    throw error;
  }
}

// Helper: Calculate position in queue (waiting only)
async function getQueuePosition(storeId, joinedAt) {
  const peopleAhead = await Queue.countDocuments({
    store: storeId,
    status: 'waiting',
    joinedAt: { $lt: joinedAt }
  });
  return { peopleAhead, positionInQueue: peopleAhead + 1 };
}

// Helper: Activate scheduled queues when time window starts
async function activateScheduledQueues(io) {
  const now = new Date();
  const scheduled = await Queue.find({
    status: 'scheduled',
    scheduledStart: { $lte: now }
  }).populate('store');

  for (const queue of scheduled) {
    const store = await Store.findById(queue.store._id);
    if (!store) {
      continue;
    }

    // If window already passed, mark no-show
    if (queue.scheduledEnd && now > queue.scheduledEnd) {
      queue.status = 'no-show';
      queue.serviceEndTime = now;
      await queue.save();
      continue;
    }

    if (store.currentQueueSize >= store.maxQueueSize) {
      continue;
    }

    // Activate
    const peopleAhead = store.currentQueueSize;
    const perPersonTime = await getMlPerPersonTime(store, store.currentQueueSize);
    queue.status = 'waiting';
    queue.joinedAt = now;
    queue.estimatedWaitTime = Math.round((peopleAhead * perPersonTime) * 100) / 100;
    queue.waitTimeUpdatedAt = now;
    await queue.save();

    store.currentQueueSize += 1;
    await store.save();

    if (io) {
      io.to(`store-${store._id}`).emit('customerJoined', {
        storeId: store._id,
        currentQueueSize: store.currentQueueSize,
        newCustomer: {
          tokenNumber: queue.tokenNumber
        },
        timestamp: now.toISOString()
      });
    }
  }
}

// Helper: Mark no-show for queues that were not checked in
async function processNoShows(io) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - DEFAULT_NO_SHOW_MINUTES * 60000);

  const candidates = await Queue.find({
    status: 'waiting',
    checkedInAt: { $in: [null, undefined] },
    joinedAt: { $lte: cutoff }
  });

  for (const queue of candidates) {
    queue.status = 'no-show';
    queue.serviceEndTime = now;
    await queue.save();

    const store = await Store.findById(queue.store);
    if (store) {
      store.currentQueueSize = Math.max(0, store.currentQueueSize - 1);
      await store.save();
      await recalculateWaitTimes(store._id, io);
    }

    if (io) {
      io.to(`queue-${queue._id}`).emit('statusUpdate', {
        queueId: queue._id,
        status: queue.status,
        timestamp: now.toISOString()
      });

      io.to(`store-${queue.store}`).emit('queueStatusUpdate', {
        queueId: queue._id,
        tokenNumber: queue.tokenNumber,
        status: queue.status,
        timestamp: now.toISOString()
      });
    }
  }
}

async function getMlPerPersonTime(store, currentQueueSize) {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const historicalQueues = await Queue.find({
      store: store._id,
      status: 'completed',
      joinedAt: { $gte: sevenDaysAgo },
      $or: [
        { actualServiceTime: { $exists: true, $ne: null } },
        { actualWaitTime: { $exists: true, $ne: null } }
      ]
    }).select('joinedAt actualWaitTime actualServiceTime').sort('joinedAt');

    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: resolveActualTime(q)
    }));

    const historicalAvgWait = historicalQueues.length > 0
      ? historicalQueues.reduce((sum, q) => sum + resolveActualTime(q), 0) / historicalQueues.length
      : 0;

    const counters = Math.max(1, store.activeCounters || 1);
    const fallbackEstimate = Math.round(((store.currentQueueSize / counters) * store.avgServiceTime) * 100) / 100;
    const adjustedEstimate = historicalAvgWait > 0
      ? Math.round(((fallbackEstimate * 0.5) + (historicalAvgWait * 0.5)) * 100) / 100
      : fallbackEstimate;

    const arimaResponse = await axios.post(`${ARIMA_SERVICE_URL}/forecast`, {
      storeId: store._id.toString(),
      storeData: { category: store.category },
      historicalData,
      currentQueueSize: store.currentQueueSize,
      avgServiceTime: store.avgServiceTime,
      historicalAvgWait
    }, { timeout: 4000 });

    if (arimaResponse.data && arimaResponse.data.success) {
      const arimaEstimate = arimaResponse.data.data.estimatedWaitTime;
      const finalEstimate = Math.round(((arimaEstimate * 0.6) + (adjustedEstimate * 0.4)) * 100) / 100;
      const perPerson = finalEstimate / Math.max(1, currentQueueSize);
      return Math.max(1, perPerson);
    }
  } catch (error) {
    // Fallback below
  }

  return Math.max(1, store.avgServiceTime);
}

function getStoreHoursForToday(store) {
  const dayKey = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const hours = store.operatingHours && store.operatingHours[dayKey];
  if (hours && hours.open && hours.close) {
    return { open: hours.open, close: hours.close };
  }
  return { open: '08:00', close: '20:00' };
}

function getThrottleLimit(store) {
  if (!store.autoThrottleEnabled) {
    return store.maxQueueSize;
  }
  if (store.autoThrottleLimit && store.autoThrottleLimit > 0) {
    return Math.min(store.autoThrottleLimit, store.maxQueueSize);
  }
  const ninetyPct = Math.floor(store.maxQueueSize * 0.9);
  return Math.max(1, Math.min(ninetyPct, store.maxQueueSize));
}

// ✅ JOIN QUEUE
exports.joinQueue = async (req, res) => {
  try {
    const { storeId, priority, notes } = req.body;

    // Check if store exists
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Check if store is active
    if (!store.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Store is currently not accepting customers'
      });
    }

    // Check if queue is full or throttled
    const throttleLimit = getThrottleLimit(store);
    if (store.currentQueueSize >= throttleLimit) {
      return res.status(400).json({
        success: false,
        message: store.currentQueueSize >= store.maxQueueSize
          ? 'Queue is full. Please try again later.'
          : 'Queue is temporarily paused. Please try again later.'
      });
    }

    // Check if customer already in queue
    const existingQueue = await Queue.findOne({
      store: storeId,
      customer: req.user.id,
      status: { $in: ['scheduled', 'waiting', 'in-service'] }
    });

    if (existingQueue) {
      return res.status(400).json({
        success: false,
        message: 'You are already in queue for this store'
      });
    }

    // Validate priority
    const allowedPriorities = (store.priorityRules && store.priorityRules.length > 0)
      ? store.priorityRules
      : ['normal', 'high', 'urgent'];

    const finalPriority = priority || 'normal';
    if (!allowedPriorities.includes(finalPriority)) {
      return res.status(400).json({
        success: false,
        message: 'Selected priority is not allowed for this store'
      });
    }



    // Generate token number
    const todayQueues = await Queue.countDocuments({
      store: storeId,
      joinedAt: {
        $gte: new Date().setHours(0, 0, 0, 0),
        $lt: new Date().setHours(23, 59, 59, 999)
      }
    });
    const tokenNumber = `${store.name.substring(0, 3).toUpperCase()}-${todayQueues + 1}`;

    // Calculate wait time
    const peopleAhead = store.currentQueueSize;
    const perPersonTime = await getMlPerPersonTime(store, store.currentQueueSize);
    const estimatedWaitTime = Math.round((peopleAhead * perPersonTime) * 100) / 100;

    // Create queue entry
    const queue = await Queue.create({
      store: storeId,
      customer: req.user.id,
      tokenNumber,
      priority: finalPriority,
      notes,
      estimatedWaitTime,
      waitTimeUpdatedAt: new Date()
    });

    // Update store queue size
    store.currentQueueSize += 1;
    await store.save();

    // Get customer and store details
    await queue.populate('customer', 'name phone email');
    await queue.populate('store', 'name address phone');

    // 📡 Send real-time update to everyone
    const io = req.app.get('io');
    if (io) {
      io.to(`store-${storeId}`).emit('customerJoined', {
        storeId,
        currentQueueSize: store.currentQueueSize,
        newCustomer: {
          tokenNumber: queue.tokenNumber,
          name: queue.customer.name
        },
        timestamp: new Date().toISOString()
      });
    }

    // Recalculate wait times for all waiting customers
    await recalculateWaitTimes(storeId, io);

    res.status(201).json({
      success: true,
      message: 'Successfully joined the queue',
      data: { queue }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ⏰ JOIN QUEUE LATER (SCHEDULED)
exports.joinQueueLater = async (req, res) => {
  try {
    const { storeId, scheduledStart, scheduledEnd, priority, notes } = req.body;

    if (!storeId || !scheduledStart || !scheduledEnd) {
      return res.status(400).json({
        success: false,
        message: 'Please provide storeId, scheduledStart, and scheduledEnd'
      });
    }

    const start = new Date(scheduledStart);
    const end = new Date(scheduledEnd);
    const now = new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({
        success: false,
        message: 'Invalid time window'
      });
    }

    if (end <= now) {
      return res.status(400).json({
        success: false,
        message: 'Scheduled window must be in the future'
      });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    if (!store.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Store is currently not accepting customers'
      });
    }

    const allowedPriorities = (store.priorityRules && store.priorityRules.length > 0)
      ? store.priorityRules
      : ['normal', 'high', 'urgent'];

    const finalPriority = priority || 'normal';
    if (!allowedPriorities.includes(finalPriority)) {
      return res.status(400).json({
        success: false,
        message: 'Selected priority is not allowed for this store'
      });
    }



    const existingQueue = await Queue.findOne({
      store: storeId,
      customer: req.user.id,
      status: { $in: ['scheduled', 'waiting', 'in-service'] }
    });

    if (existingQueue) {
      return res.status(400).json({
        success: false,
        message: 'You are already in queue for this store'
      });
    }

    const hours = getStoreHoursForToday(store);
    const [openH, openM] = hours.open.split(':').map(Number);
    const [closeH, closeM] = hours.close.split(':').map(Number);
    const openTime = new Date(start);
    openTime.setHours(openH, openM, 0, 0);
    const closeTime = new Date(start);
    closeTime.setHours(closeH, closeM, 0, 0);

    if (start < openTime || end > closeTime) {
      return res.status(400).json({
        success: false,
        message: `Time window must be within store hours (${hours.open}-${hours.close})`
      });
    }

    const todayQueues = await Queue.countDocuments({
      store: storeId,
      joinedAt: {
        $gte: new Date().setHours(0, 0, 0, 0),
        $lt: new Date().setHours(23, 59, 59, 999)
      }
    });
    const tokenNumber = `${store.name.substring(0, 3).toUpperCase()}-${todayQueues + 1}`;

    const queue = await Queue.create({
      store: storeId,
      customer: req.user.id,
      tokenNumber,
      priority: finalPriority,
      notes,
      status: 'scheduled',
      scheduledStart: start,
      scheduledEnd: end,
      estimatedWaitTime: 0,
      waitTimeUpdatedAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Scheduled successfully',
      data: { queue }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 🚪 WITHDRAW FROM QUEUE (NEW FEATURE!)
exports.withdrawFromQueue = async (req, res) => {
  try {
    const queue = await Queue.findById(req.params.id);

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found'
      });
    }

    // Check if this is your queue entry
    if (queue.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to withdraw from this queue'
      });
    }

    // Can only withdraw if waiting or scheduled
    if (!['waiting', 'scheduled'].includes(queue.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot withdraw. Current status: ${queue.status}`
      });
    }

    const wasScheduled = queue.status === 'scheduled';

    // Update queue status to cancelled
    queue.status = 'cancelled';
    queue.serviceEndTime = new Date();
    await queue.save();

    // Decrease store queue size if already waiting
    const store = await Store.findById(queue.store);
    const io = req.app.get('io');
    if (store && !wasScheduled) {
      store.currentQueueSize = Math.max(0, store.currentQueueSize - 1);
      await store.save();
      await recalculateWaitTimes(queue.store, io);
    }

    // 📡 Send real-time update
    if (io) {
      io.to(`store-${queue.store}`).emit('customerWithdrew', {
        storeId: queue.store,
        currentQueueSize: store.currentQueueSize,
        tokenNumber: queue.tokenNumber,
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Successfully withdrew from queue. Wait times updated for others.',
      data: {
        queueId: queue._id,
        tokenNumber: queue.tokenNumber,
        withdrawTime: queue.serviceEndTime
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 📋 GET MY QUEUES
exports.getMyQueues = async (req, res) => {
  try {
    await activateScheduledQueues(req.app.get('io'));

    const queues = await Queue.find({
      customer: req.user.id,
      status: { $in: ['scheduled', 'waiting', 'in-service'] }
    })
      .populate('store', 'name address phone category avgServiceTime currentQueueSize priorityRules')
      .sort('-joinedAt');

    const enriched = await Promise.all(
      queues.map(async (queue) => {
        if (queue.status === 'waiting') {
          const { peopleAhead, positionInQueue } = await getQueuePosition(
            queue.store._id,
            queue.joinedAt
          );
          return {
            ...queue.toObject(),
            peopleAhead,
            positionInQueue
          };
        }
        return queue.toObject();
      })
    );

    res.status(200).json({
      success: true,
      count: enriched.length,
      data: { queues: enriched }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 🔍 GET SINGLE QUEUE
exports.getQueue = async (req, res) => {
  try {
    const queue = await Queue.findById(req.params.id)
      .populate('customer', 'name phone email')
      .populate('store', 'name address phone');

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found'
      });
    }

    // Check authorization
    const store = await Store.findById(queue.store._id);
    if (
      queue.customer._id.toString() !== req.user.id &&
      store.owner.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this queue'
      });
    }

    res.status(200).json({
      success: true,
      data: { queue }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 🏪 GET STORE QUEUE (for store owners)
exports.getStoreQueue = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { status } = req.query;

    await activateScheduledQueues(req.app.get('io'));

    // Verify store ownership
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    if (store.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this store queue'
      });
    }

    // Build query
    let query = { store: storeId };
    if (status) {
      query.status = status;
    } else {
      query.status = { $in: ['waiting', 'in-service'] };
    }


    const queues = await Queue.find(query)
      .populate('customer', 'name phone email')
      .sort('joinedAt');

    res.status(200).json({
      success: true,
      count: queues.length,
      data: { queues }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 🔄 UPDATE QUEUE STATUS (for store owners)
exports.updateQueueStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const queue = await Queue.findById(req.params.id).populate('store');

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found'
      });
    }

    // Verify store ownership
    if (queue.store.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this queue'
      });
    }

    const oldStatus = queue.status;
    queue.status = status;

    // Update timestamps
    if (status === 'in-service' && !queue.serviceStartTime) {
      queue.serviceStartTime = new Date();
      const waitTime = Math.floor((queue.serviceStartTime - queue.joinedAt) / 60000);
      queue.actualWaitTime = waitTime;

      if (queue.estimatedServiceTime == null) {
        const perPersonTime = await getMlPerPersonTime(queue.store, Math.max(1, queue.store.currentQueueSize || 1));
        queue.estimatedServiceTime = Math.round(perPersonTime * 100) / 100;
      }
    }

    if (status === 'in-service' && !queue.checkedInAt) {
      queue.checkedInAt = new Date();
    }

    if (status === 'completed' || status === 'cancelled' || status === 'no-show') {
      if (!queue.serviceEndTime) {
        queue.serviceEndTime = new Date();
      }

      if (status === 'completed') {
        if (queue.serviceStartTime && queue.serviceEndTime) {
          const serviceMinutes = Math.max(
            1,
            Math.round(((queue.serviceEndTime - queue.serviceStartTime) / 60000) * 100) / 100
          );
          queue.actualServiceTime = serviceMinutes;
        } else if (queue.serviceEndTime && queue.joinedAt) {
          const totalMinutes = Math.max(
            1,
            Math.round(((queue.serviceEndTime - queue.joinedAt) / 60000) * 100) / 100
          );
          queue.actualServiceTime = totalMinutes;
        }
      }

      // Decrease queue size
      if (oldStatus === 'waiting' || oldStatus === 'in-service') {
        const store = await Store.findById(queue.store._id);
        store.currentQueueSize = Math.max(0, store.currentQueueSize - 1);
        await store.save();

        // Recalculate wait times
        const io = req.app.get('io');
        await recalculateWaitTimes(queue.store._id, io);
      }
    }

    await queue.save();

    // 📡 Send real-time update
    const io = req.app.get('io');
    if (io) {
      io.to(`queue-${queue._id}`).emit('statusUpdate', {
        queueId: queue._id,
        status: queue.status,
        timestamp: new Date().toISOString()
      });

      io.to(`store-${queue.store._id}`).emit('queueStatusUpdate', {
        queueId: queue._id,
        tokenNumber: queue.tokenNumber,
        status: queue.status,
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Queue status updated successfully',
      data: { queue }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ✅ CUSTOMER CHECK-IN
exports.checkInQueue = async (req, res) => {
  try {
    const queue = await Queue.findById(req.params.id);

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found'
      });
    }

    if (status === 'completed') {
      const actual = resolveActualTime(queue);
      const estimated = resolveEstimatedTime(queue);
      if (actual != null && estimated != null) {
        queue.forecastError = Math.round((actual - estimated) * 100) / 100;
      }
    }

    if (queue.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to check in for this queue'
      });
    }

    if (queue.checkedInAt) {
      return res.status(400).json({
        success: false,
        message: 'Already checked in'
      });
    }

    queue.checkedInAt = new Date();
    await queue.save();

    res.status(200).json({
      success: true,
      message: 'Checked in successfully',
      data: { queueId: queue._id, checkedInAt: queue.checkedInAt }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 📣 CALL NEXT (Store Owner)
exports.callNext = async (req, res) => {
  try {
    const { storeId } = req.params;

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    if (store.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const query = { store: storeId, status: 'waiting' };

    // Ensure only one in-service at a time
    const inService = await Queue.findOne({ store: storeId, status: 'in-service' });
    if (inService) {
      return res.status(400).json({
        success: false,
        message: 'A customer is already in service'
      });
    }

    const next = await Queue.findOne(query).sort('joinedAt').populate('customer', 'name phone');
    if (!next) {
      return res.status(404).json({
        success: false,
        message: 'No waiting customers'
      });
    }

    next.status = 'in-service';
    next.serviceStartTime = new Date();
    const waitTime = Math.floor((next.serviceStartTime - next.joinedAt) / 60000);
    next.actualWaitTime = waitTime;

    if (next.estimatedServiceTime == null) {
      const perPersonTime = await getMlPerPersonTime(store, Math.max(1, store.currentQueueSize || 1));
      next.estimatedServiceTime = Math.round(perPersonTime * 100) / 100;
    }
    await next.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`queue-${next._id}`).emit('callNext', {
        queueId: next._id,
        tokenNumber: next.tokenNumber,
        storeId: storeId,
        timestamp: new Date().toISOString()
      });

      io.to(`store-${storeId}`).emit('callNext', {
        queueId: next._id,
        tokenNumber: next.tokenNumber,
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Call next sent',
      data: { queueId: next._id, tokenNumber: next.tokenNumber }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ❗ ADMIN: Run no-show processing
exports.runNoShowProcessing = async (req, res) => {
  try {
    await processNoShows(req.app.get('io'));
    res.status(200).json({
      success: true,
      message: 'No-show processing completed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ❗ ADMIN: Preview no-show candidates
exports.previewNoShows = async (req, res) => {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - DEFAULT_NO_SHOW_MINUTES * 60000);
    const candidates = await Queue.find({
      status: 'waiting',
      checkedInAt: { $in: [null, undefined] },
      joinedAt: { $lte: cutoff }
    }).select('tokenNumber store joinedAt').limit(20);

    res.status(200).json({
      success: true,
      data: {
        enabled: noShowEnabled,
        minutes: DEFAULT_NO_SHOW_MINUTES,
        count: candidates.length,
        candidates
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ❗ ADMIN: Toggle no-show auto processing
exports.toggleNoShow = async (req, res) => {
  try {
    const { enabled } = req.body;
    noShowEnabled = Boolean(enabled);
    res.status(200).json({
      success: true,
      data: {
        enabled: noShowEnabled,
        minutes: DEFAULT_NO_SHOW_MINUTES
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ❗ ADMIN: Get no-show status
exports.getNoShowStatus = async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      enabled: noShowEnabled,
      minutes: DEFAULT_NO_SHOW_MINUTES
    }
  });
};

// Export helpers for scheduler
exports.processScheduledQueues = activateScheduledQueues;
exports.processNoShows = processNoShows;
exports.recalculateWaitTimes = recalculateWaitTimes;
exports.getNoShowEnabled = () => noShowEnabled;

// ❌ CANCEL QUEUE (Legacy - redirects to withdraw)
exports.cancelQueue = async (req, res) => {
  return exports.withdrawFromQueue(req, res);
};

// 📊 GET QUEUE STATISTICS (for store owners)
exports.getQueueStats = async (req, res) => {
  try {
    const { storeId } = req.params;

    // Verify store ownership
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    if (store.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Get today's stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await Queue.aggregate([
      {
        $match: {
          store: store._id,
          joinedAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgWaitTime: { $avg: { $ifNull: ['$actualServiceTime', '$actualWaitTime'] } }
        }
      }
    ]);

    const totalToday = await Queue.countDocuments({
      store: storeId,
      joinedAt: { $gte: today }
    });

    res.status(200).json({
      success: true,
      data: {
        totalToday,
        currentQueueSize: store.currentQueueSize,
        stats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 📈 QUEUE ANALYTICS (Store Owner)
exports.getQueueAnalytics = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { days = 7 } = req.query;

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    if (store.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days, 10));

    const total = await Queue.countDocuments({
      store: storeId,
      joinedAt: { $gte: startDate }
    });

    const dropoffs = await Queue.countDocuments({
      store: storeId,
      joinedAt: { $gte: startDate },
      status: { $in: ['cancelled', 'no-show'] }
    });

    const completed = await Queue.find({
      store: storeId,
      joinedAt: { $gte: startDate },
      status: 'completed',
      $or: [
        { actualServiceTime: { $exists: true, $ne: null } },
        { actualWaitTime: { $exists: true, $ne: null } }
      ]
    }).select('actualWaitTime actualServiceTime');

    const avgWait = completed.length > 0
      ? Math.round((completed.reduce((sum, q) => sum + resolveActualTime(q), 0) / completed.length) * 100) / 100
      : 0;

    const peakHoursAgg = await Queue.aggregate([
      {
        $match: {
          store: store._id,
          joinedAt: { $gte: startDate }
        }
      },
      {
        $project: {
          hour: { $hour: '$joinedAt' }
        }
      },
      {
        $group: {
          _id: '$hour',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 3 }
    ]);

    const peakHours = peakHoursAgg.map(p => ({ hour: p._id, count: p.count }));
    const dropoffRate = total > 0 ? Math.round((dropoffs / total) * 10000) / 100 : 0;

    res.status(200).json({
      success: true,
      data: {
        periodDays: parseInt(days, 10),
        totalQueues: total,
        avgWait,
        dropoffRate,
        peakHours
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 📊 ADMIN: Live queues
exports.getLiveQueuesAdmin = async (req, res) => {
  try {
    const { storeId, status = 'waiting' } = req.query;
    const query = { status };
    if (storeId) {
      query.store = storeId;
    }

    const queues = await Queue.find(query)
      .populate('store', 'name category')
      .populate('customer', 'name phone')
      .sort('joinedAt');

    res.status(200).json({
      success: true,
      count: queues.length,
      data: { queues }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// 📤 ADMIN: Export queue data CSV
exports.exportQueuesCsv = async (req, res) => {
  try {
    const { storeId } = req.query;
    const query = {};
    if (storeId) query.store = storeId;

    const queues = await Queue.find(query)
      .populate('store', 'name')
      .populate('customer', 'name phone')
      .sort('-joinedAt');

    const header = [
      'queue_id',
      'store',
      'customer',
      'phone',
      'status',
      'priority',
      'joined_at',
      'estimated_wait',
      'actual_wait'
    ].join(',');

    const rows = queues.map(q => [
      q._id,
      q.store?.name || '',
      q.customer?.name || '',
      q.customer?.phone || '',
      q.status,
      q.priority || '',
      q.joinedAt ? q.joinedAt.toISOString() : '',
      resolveEstimatedTime(q) ?? '',
      resolveActualTime(q) ?? ''
    ].join(','));

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="queues.csv"');
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

module.exports = exports;
