const express = require('express');
const router = express.Router();
const {
  joinQueue,
  joinQueueLater,
  getMyQueues,
  getQueue,
  getStoreQueue,
  updateQueueStatus,
  callNext,
  withdrawFromQueue,
  cancelQueue,
  getQueueStats,
  getQueueAnalytics,
  getLiveQueuesAdmin,
  exportQueuesCsv,
  checkInQueue,
  runNoShowProcessing,
  previewNoShows,
  toggleNoShow,
  getNoShowStatus
} = require('../controllers/queueController');
const { protect, authorize } = require('../middleware/auth');

// Customer routes
router.post('/join', protect, joinQueue);
router.post('/join-later', protect, joinQueueLater);
router.get('/my-queues', protect, getMyQueues);
router.post('/:id/withdraw', protect, withdrawFromQueue);
router.post('/:id/check-in', protect, checkInQueue);
router.delete('/:id', protect, cancelQueue);

// Store owner routes
router.get('/store/:storeId', protect, authorize('store_owner'), getStoreQueue);
router.put('/:id/status', protect, authorize('store_owner'), updateQueueStatus);
router.get('/store/:storeId/stats', protect, authorize('store_owner'), getQueueStats);
router.get('/store/:storeId/analytics', protect, authorize('store_owner'), getQueueAnalytics);
router.post('/store/:storeId/call-next', protect, authorize('store_owner'), callNext);

// Admin route
router.post('/admin/no-show/run', protect, authorize('admin'), runNoShowProcessing);
router.get('/admin/no-show/preview', protect, authorize('admin'), previewNoShows);
router.post('/admin/no-show/toggle', protect, authorize('admin'), toggleNoShow);
router.get('/admin/no-show/status', protect, authorize('admin'), getNoShowStatus);
router.get('/admin/live', protect, authorize('admin'), getLiveQueuesAdmin);
router.get('/admin/export', protect, authorize('admin'), exportQueuesCsv);

// General routes
router.get('/:id', protect, getQueue);

module.exports = router;
