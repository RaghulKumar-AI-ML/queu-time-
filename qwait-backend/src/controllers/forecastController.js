const Queue = require('../models/Queue');
const Store = require('../models/Store');
const axios = require('axios');

const ARIMA_SERVICE_URL = process.env.ARIMA_SERVICE_URL || 'http://localhost:5000';

// @desc    Get forecasted wait time
// @route   POST /api/forecast/wait-time
// @access  Public
exports.getForecastedWaitTime = async (req, res) => {
  try {
    const { storeId } = req.body;

    if (!storeId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide storeId'
      });
    }

    // Get store details
    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Get historical queue data (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const historicalQueues = await Queue.find({
      store: storeId,
      status: 'completed',
      joinedAt: { $gte: sevenDaysAgo },
      actualWaitTime: { $exists: true, $ne: null }
    }).select('joinedAt actualWaitTime').sort('joinedAt');

    // Format historical data for ARIMA service
    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: q.actualWaitTime
    }));

    // Call ARIMA service
    try {
      const arimaResponse = await axios.post(`${ARIMA_SERVICE_URL}/forecast`, {
        storeId,
        historicalData,
        currentQueueSize: store.currentQueueSize,
        avgServiceTime: store.avgServiceTime
      }, {
        timeout: 5000 // 5 second timeout
      });

      if (arimaResponse.data.success) {
        return res.status(200).json({
          success: true,
          data: {
            storeId,
            storeName: store.name,
            currentQueueSize: store.currentQueueSize,
            estimatedWaitTime: arimaResponse.data.data.estimatedWaitTime,
            arimaForecast: arimaResponse.data.data.arimaForecast,
            confidenceInterval: arimaResponse.data.data.confidenceInterval,
            method: arimaResponse.data.data.method,
            historicalDataPoints: historicalData.length
          }
        });
      }
    } catch (arimaError) {
      console.log('ARIMA service unavailable, using fallback calculation');
      // Fallback to simple calculation
      const estimatedWaitTime = store.currentQueueSize * store.avgServiceTime;
      
      return res.status(200).json({
        success: true,
        data: {
          storeId,
          storeName: store.name,
          currentQueueSize: store.currentQueueSize,
          estimatedWaitTime,
          method: 'fallback',
          message: 'ARIMA service unavailable, using simple calculation'
        }
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get queue analytics and trends
// @route   GET /api/forecast/analytics/:storeId
// @access  Private (Store Owner)
exports.getQueueAnalytics = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { period = 'weekly' } = req.query;

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
        message: 'Not authorized to view analytics for this store'
      });
    }

    // Get historical data based on period
    let daysBack = 7;
    if (period === 'monthly') daysBack = 30;
    if (period === 'daily') daysBack = 1;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const historicalQueues = await Queue.find({
      store: storeId,
      joinedAt: { $gte: startDate },
      actualWaitTime: { $exists: true, $ne: null }
    }).select('joinedAt actualWaitTime status').sort('joinedAt');

    // Format for ARIMA service
    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: q.actualWaitTime
    }));

    // Call ARIMA service for trend analysis
    try {
      const trendsResponse = await axios.post(`${ARIMA_SERVICE_URL}/analyze-trends`, {
        storeId,
        historicalData,
        period
      }, {
        timeout: 5000
      });

      if (trendsResponse.data.success) {
        // Add local statistics
        const statusBreakdown = await Queue.aggregate([
          {
            $match: {
              store: store._id,
              joinedAt: { $gte: startDate }
            }
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 }
            }
          }
        ]);

        return res.status(200).json({
          success: true,
          data: {
            ...trendsResponse.data.data,
            statusBreakdown,
            period,
            dateRange: {
              from: startDate.toISOString(),
              to: new Date().toISOString()
            }
          }
        });
      }
    } catch (error) {
      // Return basic analytics without ARIMA
      const basicStats = {
        total_queues: historicalQueues.length,
        average_wait_time: historicalQueues.length > 0 
          ? Math.round(historicalQueues.reduce((sum, q) => sum + q.actualWaitTime, 0) / historicalQueues.length)
          : 0,
        method: 'basic'
      };

      return res.status(200).json({
        success: true,
        data: basicStats
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get real-time queue predictions for next 3 hours
// @route   GET /api/forecast/predictions/:storeId
// @access  Public
exports.getHourlyPredictions = async (req, res) => {
  try {
    const { storeId } = req.params;

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'Store not found'
      });
    }

    // Get last 3 days of data
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const historicalQueues = await Queue.find({
      store: storeId,
      joinedAt: { $gte: threeDaysAgo },
      actualWaitTime: { $exists: true, $ne: null }
    }).select('joinedAt actualWaitTime').sort('joinedAt');

    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: q.actualWaitTime
    }));

    // Get predictions for next 3 hours
    const predictions = [];
    const currentHour = new Date();
    
    for (let i = 0; i < 3; i++) {
      const targetHour = new Date(currentHour);
      targetHour.setHours(currentHour.getHours() + i);
      
      try {
        const response = await axios.post(`${ARIMA_SERVICE_URL}/forecast`, {
          storeId,
          historicalData,
          currentQueueSize: store.currentQueueSize + i, // Assume slight increase
          avgServiceTime: store.avgServiceTime
        }, {
          timeout: 5000
        });

        if (response.data.success) {
          predictions.push({
            hour: targetHour.toISOString(),
            estimatedWaitTime: response.data.data.estimatedWaitTime,
            confidenceInterval: response.data.data.confidenceInterval
          });
        }
      } catch (error) {
        // Fallback prediction
        predictions.push({
          hour: targetHour.toISOString(),
          estimatedWaitTime: store.avgServiceTime * (store.currentQueueSize + i),
          method: 'fallback'
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        storeId,
        storeName: store.name,
        currentTime: new Date().toISOString(),
        predictions
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Check ARIMA service health
// @route   GET /api/forecast/health
// @access  Public
exports.checkServiceHealth = async (req, res) => {
  try {
    const response = await axios.get(`${ARIMA_SERVICE_URL}/health`, {
      timeout: 3000
    });
    
    res.status(200).json({
      success: true,
      data: {
        arimaService: response.data,
        nodeService: {
          status: 'healthy',
          timestamp: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: 'ARIMA service unavailable',
      data: {
        arimaService: { status: 'down' },
        nodeService: {
          status: 'healthy',
          timestamp: new Date().toISOString()
        }
      }
    });
  }
};