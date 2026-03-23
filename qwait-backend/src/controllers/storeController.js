const Store = require('../models/Store');

// @desc    Create new store
// @route   POST /api/stores
// @access  Private (Store Owner only)
exports.createStore = async (req, res) => {
  try {
    const {
      name,
      category,
      description,
      address,
      phone,
      email,
      operatingHours,
      services,
      avgServiceTime,
      maxQueueSize,
      autoThrottleEnabled,
      autoThrottleLimit,
      priorityRules
    } = req.body;

    // Check if user is store owner
    if (req.user.role !== 'store_owner') {
      return res.status(403).json({
        success: false,
        message: 'Only store owners can create stores'
      });
    }

    // Create store
    const store = await Store.create({
      owner: req.user.id,
      name,
      category,
      description,
      address,
      phone,
      email,
      operatingHours,
      services,
      avgServiceTime,
      maxQueueSize,
      autoThrottleEnabled,
      autoThrottleLimit,
      priorityRules
    });

    res.status(201).json({
      success: true,
      message: 'Store created successfully',
      data: { store }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all stores
// @route   GET /api/stores
// @access  Public
exports.getAllStores = async (req, res) => {
  try {
    const { category, city, search } = req.query;

    // Build query
    let query = { isActive: true };

    if (category) {
      query.category = category;
    }

    if (city) {
      query['address.city'] = new RegExp(city, 'i');
    }

    if (search) {
      query.name = new RegExp(search, 'i');
    }

    const stores = await Store.find(query)
      .populate('owner', 'name email phone')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: stores.length,
      data: { stores }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get all stores (admin)
// @route   GET /api/stores/admin/all
// @access  Private (Admin)
exports.getAllStoresAdmin = async (req, res) => {
  try {
    const stores = await Store.find({})
      .populate('owner', 'name email phone')
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: stores.length,
      data: { stores }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update store (admin)
// @route   PUT /api/stores/admin/:id
// @access  Private (Admin)
exports.updateStoreAdmin = async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Store updated successfully',
      data: { store }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get single store
// @route   GET /api/stores/:id
// @access  Public
exports.getStore = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id)
      .populate('owner', 'name email phone');

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { store }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Update store
// @route   PUT /api/stores/:id
// @access  Private (Store Owner only)
exports.updateStore = async (req, res) => {
  try {
    let store = await Store.findById(req.params.id);

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Check if user owns the store
    if (store.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this store'
      });
    }

    store = await Store.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      message: 'Store updated successfully',
      data: { store }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Delete store
// @route   DELETE /api/stores/:id
// @access  Private (Store Owner only)
exports.deleteStore = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Check if user owns the store
    if (store.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this store'
      });
    }

    await store.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Store deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get my stores
// @route   GET /api/stores/my/stores
// @access  Private (Store Owner only)
exports.getMyStores = async (req, res) => {
  try {
    const stores = await Store.find({ owner: req.user.id })
      .sort('-createdAt');

    res.status(200).json({
      success: true,
      count: stores.length,
      data: { stores }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
