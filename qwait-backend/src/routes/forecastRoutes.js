const express = require('express');
const router = express.Router();
const {
  getForecastedWaitTime,
  getQueueAnalytics,
  getHourlyPredictions,
  checkServiceHealth,
  getSLAStats,
  retrainModels,
  getModelInfo,
  getModelPerformance,
  getPredictionSeries
} = require('../controllers/forecastController');
const { protect, authorize } = require('../middleware/auth');

// Public routes
router.post('/wait-time', getForecastedWaitTime);
router.get('/predictions/:storeId', getHourlyPredictions);
router.get('/health', checkServiceHealth);

// Protected routes (Store Owner)
router.get('/analytics/:storeId', protect, authorize('store_owner'), getQueueAnalytics);
router.get('/sla/:storeId', protect, authorize('store_owner'), getSLAStats);
router.get('/model-performance/:storeId', protect, authorize('store_owner'), getModelPerformance);
router.get('/prediction-series/:storeId', protect, authorize('store_owner'), getPredictionSeries);

// Admin routes
router.post('/retrain', protect, authorize('admin'), retrainModels);
router.get('/model-info', protect, authorize('admin'), getModelInfo);

module.exports = router;
