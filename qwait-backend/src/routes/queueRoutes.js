const express = require('express');
const router = express.Router();
const {
  joinQueue,
  getMyQueues,
  getQueue,
  getStoreQueue,
  updateQueueStatus,
  withdrawFromQueue,
  cancelQueue,
  getQueueStats
} = require('../controllers/queueController');
const { protect, authorize } = require('../middleware/auth');

// Customer routes
router.post('/join', protect, joinQueue);
router.get('/my-queues', protect, getMyQueues);
router.post('/:id/withdraw', protect, withdrawFromQueue);
router.delete('/:id', protect, cancelQueue);

// General routes
router.get('/:id', protect, getQueue);

// Store owner routes
router.get('/store/:storeId', protect, authorize('store_owner'), getStoreQueue);
router.put('/:id/status', protect, authorize('store_owner'), updateQueueStatus);
router.get('/store/:storeId/stats', protect, authorize('store_owner'), getQueueStats);

module.exports = router;