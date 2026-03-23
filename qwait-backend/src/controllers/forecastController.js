const Queue = require('../models/Queue');
const Store = require('../models/Store');
const axios = require('axios');

const ARIMA_SERVICE_URL = process.env.ARIMA_SERVICE_URL || 'http://localhost:5000';

const resolveActualTime = (q) => (q.actualServiceTime ?? q.actualWaitTime);
const resolveEstimatedTime = (q) => (q.estimatedServiceTime ?? q.estimatedWaitTime);

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
      $or: [
        { actualServiceTime: { $exists: true, $ne: null } },
        { actualWaitTime: { $exists: true, $ne: null } }
      ]
    }).select('joinedAt actualWaitTime actualServiceTime').sort('joinedAt');

    // Format historical data for ARIMA service
    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: resolveActualTime(q)
    }));

    const historicalAvgWait = historicalQueues.length > 0
      ? historicalQueues.reduce((sum, q) => sum + resolveActualTime(q), 0) / historicalQueues.length
      : 0;

    // Explainability signals
    const now = new Date();
    const last10 = new Date(now.getTime() - 10 * 60000);
    const prev60 = new Date(now.getTime() - 60 * 60000);
    const arrivalsLast10 = await Queue.countDocuments({
      store: storeId,
      joinedAt: { $gte: last10 }
    });
    const arrivalsPrev60 = await Queue.countDocuments({
      store: storeId,
      joinedAt: { $gte: prev60, $lt: last10 }
    });
    const avgPer10 = arrivalsPrev60 / 5; // average per 10 mins in last hour
    const isSurge = arrivalsLast10 > Math.max(2, Math.ceil(avgPer10 * 1.5));

    const hourCounts = historicalQueues.reduce((acc, q) => {
      const h = new Date(q.joinedAt).getHours();
      acc[h] = (acc[h] || 0) + 1;
      return acc;
    }, {});
    const peakHour = Object.keys(hourCounts).sort((a, b) => hourCounts[b] - hourCounts[a])[0];
    const currentHour = now.getHours();
    const isPeakHour = peakHour != null && parseInt(peakHour, 10) === currentHour;

    const explanations = [];
    const queueSize = store.currentQueueSize || 0;
    const totalCounters = Math.max(1, store.counters || 1);
    const activeCounters = Math.max(1, store.activeCounters || 1);
    const inactiveCounters = Math.max(0, totalCounters - activeCounters);

    if (queueSize >= 12) {
      explanations.push(`High queue length (${queueSize} in line)`);
    } else if (queueSize <= 2) {
      explanations.push(`Low queue length (${queueSize} in line)`);
    }
    if (inactiveCounters > 0) {
      explanations.push(`Limited counters active (${activeCounters}/${totalCounters})`);
    }
    if (isSurge) {
      explanations.push(`Reason: More arrivals in last 10 mins (${arrivalsLast10} vs avg ${Math.round(avgPer10)})`);
    }
    if (isPeakHour) {
      explanations.push('Peak hour detected based on last 7 days');
    }
    if (!isSurge && !isPeakHour && explanations.length === 0) {
      explanations.push('Wait time mainly driven by current queue size and service rate');
    }

    const counters = activeCounters;
    const fallbackEstimate = Math.round(((queueSize / counters) * store.avgServiceTime) * 100) / 100;
    const adjustedEstimate = historicalAvgWait > 0
      ? Math.round(((fallbackEstimate * 0.5) + (historicalAvgWait * 0.5)) * 100) / 100
      : fallbackEstimate;

    // Smart recommendations (heuristic)
    const recommendations = [];
    if (counters >= 2) {
      const bestCounter = (store.currentQueueSize % counters) + 1;
      const fasterBy = Math.max(1, Math.round(store.avgServiceTime * 0.5));
      recommendations.push({
        title: `Go to Counter ${bestCounter} → ~${fasterBy} mins faster`,
        rationale: 'Load is likely lighter on that counter based on current distribution.',
        type: 'counter'
      });
    }

    if (isSurge || isPeakHour) {
      const delay = isPeakHour ? 30 : 20;
      recommendations.push({
        title: `Visit after ${delay} mins ??? lower crowd`,
        rationale: isPeakHour ? 'Peak hour detected; crowd typically eases after this window.' : 'Recent surge detected; short wait may reduce queue.',
        type: 'timing'
      });
    } else if (queueSize >= 12) {
      recommendations.push({
        title: 'Visit later ??? avoid long queue',
        rationale: `Current queue is high (${queueSize} waiting).`,
        type: 'timing'
      });
    } else if (queueSize <= 2) {
      recommendations.push({
        title: 'Join now ??? shortest wait',
        rationale: 'Low queue length right now.',
        type: 'timing'
      });
    } else {
      recommendations.push({
        title: 'Join now ??? shortest wait',
        rationale: 'No surge or peak-hour patterns detected.',
        type: 'timing'
      });
    }

    // Call ARIMA service
    try {
      const arimaResponse = await axios.post(`${ARIMA_SERVICE_URL}/forecast`, {
        storeId,
        storeData: {
          category: store.category
        },
        historicalData,
        currentQueueSize: store.currentQueueSize,
        avgServiceTime: store.avgServiceTime,
        historicalAvgWait
      }, {
        timeout: 5000 // 5 second timeout
      });

      if (arimaResponse.data.success) {
        const arimaEstimate = arimaResponse.data.data.estimatedWaitTime;
        const finalEstimate = Math.round(((arimaEstimate * 0.6) + (adjustedEstimate * 0.4)) * 100) / 100;
        const confidenceInterval = arimaResponse.data.data.confidenceInterval;
        const dataPoints = historicalQueues.length;
        let confidenceLevel = 'low';
        let confidenceRationale = dataPoints < 5
          ? 'Very limited recent history for this store.'
          : 'Limited data or wide confidence interval.';

        if (confidenceInterval && arimaEstimate > 0) {
          const width = confidenceInterval.upper - confidenceInterval.lower;
          const ratio = width / arimaEstimate;
          if (ratio <= 0.3 && dataPoints >= 15) {
            confidenceLevel = 'high';
            confidenceRationale = 'Narrow interval with solid historical data volume.';
          } else if (ratio <= 0.6 || dataPoints >= 5) {
            confidenceLevel = 'medium';
            confidenceRationale = 'Moderate interval width with some recent data.';
          }
        }

        console.log(`ARIMA vs fallback: arima=${arimaEstimate} fallback=${fallbackEstimate} adjusted=${adjustedEstimate} final=${finalEstimate}`);

        return res.status(200).json({
          success: true,
          data: {
            storeId,
            storeName: store.name,
            currentQueueSize: store.currentQueueSize,
            estimatedWaitTime: finalEstimate,
            arimaForecast: arimaResponse.data.data.arimaForecast,
            confidenceInterval,
            confidenceLevel,
            confidenceRationale,
            method: arimaResponse.data.data.method,
            historicalDataPoints: historicalData.length,
            fallbackEstimate,
            adjustedEstimate,
            compare: {
              arimaEstimate,
              fallbackEstimate,
              adjustedEstimate
            },
            explanations,
            recommendations,
            counters
          }
        });
      }
    } catch (arimaError) {
      console.log('ARIMA service unavailable, using fallback calculation');
      // Fallback to simple calculation
      const estimatedWaitTime = adjustedEstimate;
      
      return res.status(200).json({
        success: true,
        data: {
          storeId,
          storeName: store.name,
          currentQueueSize: store.currentQueueSize,
          estimatedWaitTime,
          method: 'fallback',
          message: 'ARIMA service unavailable, using adjusted calculation',
          fallbackEstimate,
          adjustedEstimate,
          confidenceLevel: 'low',
          confidenceRationale: 'ARIMA service unavailable; using fallback estimate.',
          explanations,
          recommendations,
          counters
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
      $or: [
        { actualServiceTime: { $exists: true, $ne: null } },
        { actualWaitTime: { $exists: true, $ne: null } }
      ]
    }).select('joinedAt actualWaitTime actualServiceTime status').sort('joinedAt');

    // Format for ARIMA service
    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: resolveActualTime(q)
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
          ? Math.round(historicalQueues.reduce((sum, q) => sum + resolveActualTime(q), 0) / historicalQueues.length)
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
      $or: [
        { actualServiceTime: { $exists: true, $ne: null } },
        { actualWaitTime: { $exists: true, $ne: null } }
      ]
    }).select('joinedAt actualWaitTime actualServiceTime').sort('joinedAt');

    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: resolveActualTime(q)
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

// @desc    Trigger ARIMA model retrain (admin)
// @route   POST /api/forecast/retrain
// @access  Private (Admin)
exports.retrainModels = async (req, res) => {
  try {
    const response = await axios.post(`${ARIMA_SERVICE_URL}/retrain`, {}, { timeout: 3000 });
    res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: 'ARIMA retrain unavailable'
    });
  }
};

// @desc    Get ARIMA model info
// @route   GET /api/forecast/model-info
// @access  Private (Admin)
exports.getModelInfo = async (req, res) => {
  try {
    const response = await axios.get(`${ARIMA_SERVICE_URL}/model-info`, { timeout: 3000 });
    res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    res.status(200).json({
      success: false,
      message: 'ARIMA model info unavailable'
    });
  }
};
// @desc    Get SLA stats (avg actual vs estimated + variance)
// @route   GET /api/forecast/sla/:storeId
// @access  Private (Store Owner)
exports.getSLAStats = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { period = '7d' } = req.query;

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
        message: 'Not authorized to view SLA stats for this store'
      });
    }

    const startDate = new Date();
    if (period === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else {
      startDate.setDate(startDate.getDate() - 7);
    }

    const queues = await Queue.find({
      store: storeId,
      status: 'completed',
      joinedAt: { $gte: startDate },
      $or: [
        { actualServiceTime: { $exists: true, $ne: null } },
        { actualWaitTime: { $exists: true, $ne: null } }
      ]
    }).select('estimatedWaitTime estimatedServiceTime actualWaitTime actualServiceTime');

    const count = queues.length;
    if (count === 0) {
      return res.status(200).json({
        success: true,
        data: {
          count: 0,
          avgEstimated: 0,
          avgActual: 0,
          meanError: 0,
          variance: 0,
          period
        }
      });
    }

    const avgEstimated = queues.reduce((sum, q) => sum + resolveEstimatedTime(q), 0) / count;
    const avgActual = queues.reduce((sum, q) => sum + resolveActualTime(q), 0) / count;
    const errors = queues.map(q => resolveActualTime(q) - resolveEstimatedTime(q));
    const meanError = errors.reduce((sum, e) => sum + e, 0) / count;
    const variance = errors.reduce((sum, e) => sum + Math.pow(e - meanError, 2), 0) / count;

    res.status(200).json({
      success: true,
      data: {
        count,
        avgEstimated: Math.round(avgEstimated * 100) / 100,
        avgActual: Math.round(avgActual * 100) / 100,
        meanError: Math.round(meanError * 100) / 100,
        variance: Math.round(variance * 100) / 100,
        period
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get model performance metrics
// @route   GET /api/forecast/model-performance/:storeId
// @access  Private (Store Owner)
exports.getModelPerformance = async (req, res) => {
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
        message: 'Not authorized to view model performance for this store'
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days, 10));

    const queues = await Queue.find({
      store: storeId,
      status: 'completed',
      joinedAt: { $gte: startDate },
      $and: [
        {
          $or: [
            { actualServiceTime: { $exists: true, $ne: null } },
            { actualWaitTime: { $exists: true, $ne: null } }
          ]
        },
        {
          $or: [
            { estimatedServiceTime: { $exists: true, $ne: null } },
            { estimatedWaitTime: { $exists: true, $ne: null } }
          ]
        }
      ]
    }).select('estimatedWaitTime estimatedServiceTime actualWaitTime actualServiceTime');

    if (queues.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          count: 0,
          mae: 0,
          rmse: 0,
          mape: 0,
          periodDays: parseInt(days, 10)
        }
      });
    }

    const errors = queues.map(q => resolveActualTime(q) - resolveEstimatedTime(q));
    const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
    const rmse = Math.sqrt(errors.reduce((s, e) => s + (e * e), 0) / errors.length);
    const mape = queues.reduce((s, q) => {
      const actual = resolveActualTime(q);
      const estimated = resolveEstimatedTime(q);
      if (!actual) return s;
      return s + (Math.abs(actual - estimated) / actual);
    }, 0) / errors.length * 100;

    const mapeRounded = Math.round(mape * 100) / 100;
    const accuracy = Math.max(0, Math.round((100 - mapeRounded) * 100) / 100);

    res.status(200).json({
      success: true,
      data: {
        count: queues.length,
        mae: Math.round(mae * 100) / 100,
        rmse: Math.round(rmse * 100) / 100,
        mape: mapeRounded,
        accuracy,
        periodDays: parseInt(days, 10)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// @desc    Get prediction series (predicted vs actual)
// @route   GET /api/forecast/prediction-series/:storeId
// @access  Private (Store Owner)
exports.getPredictionSeries = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { limit = 30 } = req.query;

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
        message: 'Not authorized to view prediction series for this store'
      });
    }

    const queues = await Queue.find({
      store: storeId,
      status: 'completed',
      $and: [
        {
          $or: [
            { actualServiceTime: { $exists: true, $ne: null } },
            { actualWaitTime: { $exists: true, $ne: null } }
          ]
        },
        {
          $or: [
            { estimatedServiceTime: { $exists: true, $ne: null } },
            { estimatedWaitTime: { $exists: true, $ne: null } }
          ]
        }
      ]
    })
      .select('joinedAt estimatedWaitTime estimatedServiceTime actualWaitTime actualServiceTime')
      .sort('-joinedAt')
      .limit(parseInt(limit, 10));

    const series = queues.reverse().map(q => ({
      time: q.joinedAt.toISOString(),
      predicted: resolveEstimatedTime(q),
      actual: resolveActualTime(q)
    }));

    res.status(200).json({
      success: true,
      data: { series }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
