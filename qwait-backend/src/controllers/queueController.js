const Queue = require('../models/Queue');
const Store = require('../models/Store');

// @desc    Join queue
// @route   POST /api/queues/join
// @access  Private (Customer)
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

    // Check if customer already in queue for this store
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

    // Calculate estimated wait time
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

    // Populate customer and store details
    await queue.populate('customer', 'name phone email');
    await queue.populate('store', 'name address phone');

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

// @desc    Get my queue status
// @route   GET /api/queues/my-queues
// @access  Private (Customer)
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

// @desc    Get queue by ID
// @route   GET /api/queues/:id
// @access  Private
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
    if (
      queue.customer._id.toString() !== req.user.id &&
      queue.store.owner.toString() !== req.user.id
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

// @desc    Get store queue (for store owners)
// @route   GET /api/queues/store/:storeId
// @access  Private (Store Owner)
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

// @desc    Update queue status (for store owners)
// @route   PUT /api/queues/:id/status
// @access  Private (Store Owner)
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

    // Update timestamps based on status
    if (status === 'in-service' && !queue.serviceStartTime) {
      queue.serviceStartTime = new Date();
      
      // Calculate actual wait time
      const waitTime = Math.floor((queue.serviceStartTime - queue.joinedAt) / 60000);
      queue.actualWaitTime = waitTime;
    }

    if (status === 'completed' || status === 'cancelled' || status === 'no-show') {
      if (!queue.serviceEndTime) {
        queue.serviceEndTime = new Date();
      }

      // Decrease queue size if moving from waiting/in-service
      if (oldStatus === 'waiting' || oldStatus === 'in-service') {
        const store = await Store.findById(queue.store._id);
        store.currentQueueSize = Math.max(0, store.currentQueueSize - 1);
        await store.save();
      }
    }

    await queue.save();

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

// @desc    Cancel queue (for customers)
// @route   DELETE /api/queues/:id
// @access  Private (Customer)
exports.cancelQueue = async (req, res) => {
  try {
    const queue = await Queue.findById(req.params.id);

    if (!queue) {
      return res.status(404).json({
        success: false,
        message: 'Queue entry not found'
      });
    }

    // Check if customer owns this queue entry
    if (queue.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this queue'
      });
    }

    // Can only cancel if waiting
    if (queue.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel queue. Status is not waiting.'
      });
    }

    queue.status = 'cancelled';
    await queue.save();

    // Update store queue size
    const store = await Store.findById(queue.store);
    store.currentQueueSize = Math.max(0, store.currentQueueSize - 1);
    await store.save();

    res.status(200).json({
      success: true,
      message: 'Queue cancelled successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get queue statistics (for store owners)
// @route   GET /api/queues/store/:storeId/stats
// @access  Private (Store Owner)
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