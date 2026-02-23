# arima_service.py
# ARIMA Model for Queue Wait Time Forecasting

from flask import Flask, request, jsonify
from statsmodels.tsa.arima.model import ARIMA
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)

class QueueForecaster:
    def __init__(self):
        self.model = None
        
    def prepare_data(self, historical_data):
        """
        Prepare historical wait time data for ARIMA
        historical_data: list of dict with 'timestamp' and 'waitTime'
        """
        if not historical_data or len(historical_data) < 10:
            return None
            
        df = pd.DataFrame(historical_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df = df.set_index('timestamp')
        df = df.sort_index()
        
        # Resample to hourly intervals and fill missing values
        df = df.resample('H').mean().fillna(method='ffill').fillna(method='bfill')
        
        return df['waitTime'].values
    
    def forecast_wait_time(self, historical_data, steps_ahead=1):
        """
        Forecast wait time using ARIMA model
        steps_ahead: number of hours to forecast ahead
        """
        try:
            # Prepare data
            series = self.prepare_data(historical_data)
            
            if series is None or len(series) < 10:
                # Not enough data, return average
                if historical_data:
                    avg_wait = np.mean([d['waitTime'] for d in historical_data])
                    return {
                        'forecasted_wait_time': round(avg_wait, 2),
                        'confidence_interval': {
                            'lower': round(avg_wait * 0.8, 2),
                            'upper': round(avg_wait * 1.2, 2)
                        },
                        'method': 'average'
                    }
                return {
                    'forecasted_wait_time': 15,
                    'confidence_interval': {'lower': 10, 'upper': 20},
                    'method': 'default'
                }
            
            # Fit ARIMA model (p=2, d=1, q=2)
            model = ARIMA(series, order=(2, 1, 2))
            fitted_model = model.fit()
            
            # Forecast
            forecast = fitted_model.forecast(steps=steps_ahead)
            forecast_conf = fitted_model.get_forecast(steps=steps_ahead).conf_int()
            
            forecasted_value = max(0, forecast[-1])  # Ensure non-negative
            lower_bound = max(0, forecast_conf[-1, 0])
            upper_bound = forecast_conf[-1, 1]
            
            return {
                'forecasted_wait_time': round(forecasted_value, 2),
                'confidence_interval': {
                    'lower': round(lower_bound, 2),
                    'upper': round(upper_bound, 2)
                },
                'method': 'arima',
                'model_order': '(2,1,2)'
            }
            
        except Exception as e:
            print(f"ARIMA Error: {str(e)}")
            # Fallback to simple average
            if historical_data:
                avg_wait = np.mean([d['waitTime'] for d in historical_data])
                return {
                    'forecasted_wait_time': round(avg_wait, 2),
                    'confidence_interval': {
                        'lower': round(avg_wait * 0.8, 2),
                        'upper': round(avg_wait * 1.2, 2)
                    },
                    'method': 'fallback_average',
                    'error': str(e)
                }
            return {
                'forecasted_wait_time': 15,
                'confidence_interval': {'lower': 10, 'upper': 20},
                'method': 'default'
            }

forecaster = QueueForecaster()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'healthy',
        'service': 'ARIMA Forecasting Service',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/forecast', methods=['POST'])
def forecast():
    """
    Forecast wait time based on historical data
    
    Request body:
    {
        "storeId": "store_id",
        "historicalData": [
            {"timestamp": "2024-01-01T10:00:00Z", "waitTime": 15},
            {"timestamp": "2024-01-01T11:00:00Z", "waitTime": 20}
        ],
        "currentQueueSize": 5,
        "avgServiceTime": 10
    }
    """
    try:
        data = request.json
        
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data provided'
            }), 400
        
        historical_data = data.get('historicalData', [])
        current_queue_size = data.get('currentQueueSize', 0)
        avg_service_time = data.get('avgServiceTime', 15)
        
        # Get ARIMA forecast
        forecast_result = forecaster.forecast_wait_time(historical_data)
        
        # Adjust forecast based on current queue
        base_forecast = forecast_result['forecasted_wait_time']
        queue_factor = current_queue_size * avg_service_time
        
        # Weighted combination of ARIMA forecast and current queue calculation
        if historical_data and len(historical_data) >= 10:
            # More weight to ARIMA if we have good historical data
            adjusted_forecast = (base_forecast * 0.6) + (queue_factor * 0.4)
        else:
            # More weight to current queue if limited historical data
            adjusted_forecast = (base_forecast * 0.3) + (queue_factor * 0.7)
        
        return jsonify({
            'success': True,
            'data': {
                'estimatedWaitTime': round(adjusted_forecast, 2),
                'arimaForecast': base_forecast,
                'queueBasedEstimate': queue_factor,
                'confidenceInterval': forecast_result['confidence_interval'],
                'method': forecast_result['method'],
                'timestamp': datetime.now().isoformat()
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/analyze-trends', methods=['POST'])
def analyze_trends():
    """
    Analyze queue trends for a store
    
    Request body:
    {
        "storeId": "store_id",
        "historicalData": [...],
        "period": "daily" | "weekly" | "monthly"
    }
    """
    try:
        data = request.json
        historical_data = data.get('historicalData', [])
        
        if not historical_data:
            return jsonify({
                'success': False,
                'message': 'No historical data provided'
            }), 400
        
        df = pd.DataFrame(historical_data)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        
        # Calculate statistics
        stats = {
            'average_wait_time': round(df['waitTime'].mean(), 2),
            'median_wait_time': round(df['waitTime'].median(), 2),
            'max_wait_time': round(df['waitTime'].max(), 2),
            'min_wait_time': round(df['waitTime'].min(), 2),
            'std_deviation': round(df['waitTime'].std(), 2),
            'total_records': len(df)
        }
        
        # Peak hours analysis
        df['hour'] = df['timestamp'].dt.hour
        peak_hours = df.groupby('hour')['waitTime'].mean().sort_values(ascending=False).head(3)
        stats['peak_hours'] = [
            {'hour': int(hour), 'avg_wait': round(wait, 2)}
            for hour, wait in peak_hours.items()
        ]
        
        # Day of week analysis
        df['day_of_week'] = df['timestamp'].dt.day_name()
        busiest_days = df.groupby('day_of_week')['waitTime'].mean().sort_values(ascending=False).head(3)
        stats['busiest_days'] = [
            {'day': day, 'avg_wait': round(wait, 2)}
            for day, wait in busiest_days.items()
        ]
        
        return jsonify({
            'success': True,
            'data': stats
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

if __name__ == '__main__':
    print("🚀 ARIMA Forecasting Service Starting...")
    print("📊 Service running on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)