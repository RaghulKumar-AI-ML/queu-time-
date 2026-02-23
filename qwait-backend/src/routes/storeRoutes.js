const express = require('express');
const router = express.Router();
const {
  createStore,
  getAllStores,
  getStore,
  updateStore,
  deleteStore,
  getMyStores
} = require('../controllers/storeController');
const { protect, authorize } = require('../middleware/auth');

// Public routes
router.get('/', getAllStores);
router.get('/:id', getStore);

// Protected routes (requires authentication)
router.post('/', protect, authorize('store_owner'), createStore);
router.put('/:id', protect, authorize('store_owner'), updateStore);
router.delete('/:id', protect, authorize('store_owner'), deleteStore);
router.get('/my/stores', protect, authorize('store_owner'), getMyStores);

module.exports = router;