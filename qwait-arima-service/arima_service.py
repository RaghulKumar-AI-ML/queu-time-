from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np
import pandas as pd
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

class PreTrainedForecaster:
    """Use pre-trained ARIMA models for forecasting"""
    
    def __init__(self, model_file='trained_arima_models.pkl'):
        self.models = None
        self.metadata = None
        self.load_models(model_file)
    
    def load_models(self, model_file):
        """Load pre-trained models from file"""
        try:
            print(f"📂 Loading pre-trained models from {model_file}...")
            with open(model_file, 'rb') as f:
                data = pickle.load(f)
            
            self.models = data['models']
            self.metadata = data['metadata']
            
            print(f"✅ Loaded {len(self.models)} trained models")
            print(f"   Store types: {', '.join(self.models.keys())}")
            print(f"   Training date: {self.metadata['training_date']}")
            
        except FileNotFoundError:
            print(f"⚠️  Model file not found. Run train_arima_model.py first!")
            self.models = {}
        except Exception as e:
            print(f"❌ Error loading models: {e}")
            self.models = {}
    
    def get_store_category(self, store_data):
        """Map store category to trained model type"""
        category_mapping = {
            'bank': 'bank',
            'hospital': 'hospital',
            'retail': 'retail',
            'restaurant': 'restaurant',
            'government': 'government',
            'other': 'retail'
        }
        
        category = store_data.get('category', 'retail')
        return category_mapping.get(category, 'retail')
    
    def forecast_wait_time(self, store_data, current_queue_size, avg_service_time):
        """Forecast wait time using pre-trained model"""
        try:
            store_type = self.get_store_category(store_data)
            
            if store_type not in self.models:
                return self.fallback_forecast(current_queue_size, avg_service_time)
            
            model_info = self.models[store_type]
            model = model_info['model']
            
            # Forecast next hour
            arima_forecast = model.forecast(steps=1)[0]
            arima_forecast = max(0, arima_forecast)
            
            # Combine ARIMA with current queue
            queue_based = current_queue_size * avg_service_time
            
            if current_queue_size > 0:
                final_forecast = (arima_forecast * 0.4) + (queue_based * 0.6)
            else:
                final_forecast = arima_forecast
            
            confidence_lower = final_forecast * 0.8
            confidence_upper = final_forecast * 1.2
            
            return {
                'forecasted_wait_time': round(final_forecast, 2),
                'arima_forecast': round(arima_forecast, 2),
                'queue_based': queue_based,
                'confidence_interval': {
                    'lower': round(confidence_lower, 2),
                    'upper': round(confidence_upper, 2)
                },
                'method': 'pretrained_arima',
                'model_type': store_type,
                'model_mae': round(model_info['mae'], 2)
            }
            
        except Exception as e:
            print(f"Forecast error: {e}")
            return self.fallback_forecast(current_queue_size, avg_service_time)
    
    def fallback_forecast(self, current_queue_size, avg_service_time):
        """Simple fallback calculation"""
        estimated_wait = current_queue_size * avg_service_time
        
        return {
            'forecasted_wait_time': estimated_wait,
            'arima_forecast': estimated_wait,
            'queue_based': estimated_wait,
            'confidence_interval': {
                'lower': estimated_wait * 0.8,
                'upper': estimated_wait * 1.2
            },
            'method': 'fallback_simple'
        }

forecaster = PreTrainedForecaster()

@app.route('/health', methods=['GET'])
def health():
    models_loaded = len(forecaster.models) if forecaster.models else 0
    return jsonify({
        'status': 'healthy',
        'service': 'Pre-trained ARIMA Forecasting Service',
        'models_loaded': models_loaded,
        'store_types': list(forecaster.models.keys()) if forecaster.models else [],
        'timestamp': datetime.now().isoformat()
    })

@app.route('/forecast', methods=['POST'])
def forecast():
    """Forecast wait time using pre-trained models"""
    try:
        data = request.json
        
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data provided'
            }), 400
        
        store_data = data.get('storeData', {})
        current_queue_size = data.get('currentQueueSize', 0)
        avg_service_time = data.get('avgServiceTime', 15)
        
        forecast_result = forecaster.forecast_wait_time(
            store_data,
            current_queue_size,
            avg_service_time
        )
        
        return jsonify({
            'success': True,
            'data': {
                'estimatedWaitTime': forecast_result['forecasted_wait_time'],
                'arimaForecast': forecast_result['arima_forecast'],
                'queueBasedEstimate': forecast_result['queue_based'],
                'confidenceInterval': forecast_result['confidence_interval'],
                'method': forecast_result['method'],
                'modelType': forecast_result.get('model_type'),
                'timestamp': datetime.now().isoformat()
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

if __name__ == '__main__':
    print("🚀 ARIMA Forecasting Service Starting...")
    print("📊 Using pre-trained models")
    print("🔍 Service running on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)