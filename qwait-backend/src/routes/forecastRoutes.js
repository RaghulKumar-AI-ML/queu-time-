const express = require('express');
const router = express.Router();
const {
  getForecastedWaitTime,
  getQueueAnalytics,
  getHourlyPredictions,
  checkServiceHealth
} = require('../controllers/forecastController');
const { protect, authorize } = require('../middleware/auth');

// Public routes
router.post('/wait-time', getForecastedWaitTime);
router.get('/predictions/:storeId', getHourlyPredictions);
router.get('/health', checkServiceHealth);

// Protected routes (Store Owner)
router.get('/analytics/:storeId', protect, authorize('store_owner'), getQueueAnalytics);

module.exports = router;