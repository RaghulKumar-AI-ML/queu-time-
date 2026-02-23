const Queue = require('../models/Queue');
const Store = require('../models/Store');

// 🔄 HELPER FUNCTION: Recalculate wait times when someone leaves
async function recalculateWaitTimes(storeId, io) {
  try {
    const store = await Store.findById(storeId);
    
    // Get all waiting people, sorted by who joined first
    const waitingQueues = await Queue.find({
      store: storeId,
      status: 'waiting'
    }).sort('joinedAt');

    // Update wait time for each person
    for (let i = 0; i < waitingQueues.length; i++) {
      const peopleAhead = i; // Position in queue (0 = first, 1 = second, etc.)
      const newWaitTime = peopleAhead * store.avgServiceTime;
      
      // Only update if wait time changed
      if (waitingQueues[i].estimatedWaitTime !== newWaitTime) {
        waitingQueues[i].estimatedWaitTime = newWaitTime;
        await waitingQueues[i].save();
        
        // 📡 Send real-time update to this person
        if (io) {
          io.to(`queue-${waitingQueues[i]._id}`).emit('waitTimeUpdate', {
            queueId: waitingQueues[i]._id,
            estimatedWaitTime: newWaitTime,
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

// ✅ JOIN QUEUE
exports.joinQueue = async (req, res) => {
  try {
    const { storeId, serviceType, priority, notes } = req.body;

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

    // Check if queue is full
    if (store.currentQueueSize >= store.maxQueueSize) {
      return res.status(400).json({
        success: false,
        message: 'Queue is full. Please try again later.'
      });
    }

    // Check if customer already in queue
    const existingQueue = await Queue.findOne({
      store: storeId,
      customer: req.user.id,
      status: { $in: ['waiting', 'in-service'] }
    });

    if (existingQueue) {
      return res.status(400).json({
        success: false,
        message: 'You are already in queue for this store'
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
    const estimatedWaitTime = peopleAhead * store.avgServiceTime;

    // Create queue entry
    const queue = await Queue.create({
      store: storeId,
      customer: req.user.id,
      tokenNumber,
      serviceType,
      priority: priority || 'normal',
      notes,
      estimatedWaitTime
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

    // Can only withdraw if waiting
    if (queue.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        message: `Cannot withdraw. Current status: ${queue.status}`
      });
    }

    // Update queue status to cancelled
    queue.status = 'cancelled';
    queue.serviceEndTime = new Date();
    await queue.save();

    // Decrease store queue size
    const store = await Store.findById(queue.store);
    store.currentQueueSize = Math.max(0, store.currentQueueSize - 1);
    await store.save();

    // Get Socket.IO
    const io = req.app.get('io');

    // 🔄 Recalculate wait times for everyone still waiting
    await recalculateWaitTimes(queue.store, io);

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
    const queues = await Queue.find({
      customer: req.user.id,
      status: { $in: ['waiting', 'in-service'] }
    })
      .populate('store', 'name address phone category')
      .sort('-joinedAt');

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
    }

    if (status === 'completed' || status === 'cancelled' || status === 'no-show') {
      if (!queue.serviceEndTime) {
        queue.serviceEndTime = new Date();
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
          avgWaitTime: { $avg: '$actualWaitTime' }
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

module.exports = exports;