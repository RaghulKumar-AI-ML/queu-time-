from flask import Flask, request, jsonify
from flask_cors import CORS
import pickle
import numpy as np
import pandas as pd
from datetime import datetime
import subprocess
import os
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
    
    def _compute_confidence_interval(self, estimate, historical_data):
        """Compute a variable confidence interval based on data volume/variance."""
        if estimate is None:
            estimate = 0
        waits = []
        if historical_data:
            for point in historical_data:
                try:
                    waits.append(float(point.get('waitTime', 0)))
                except Exception:
                    continue

        if len(waits) < 3:
            rel_width = 0.5  # low confidence when data is sparse
        else:
            mean = float(np.mean(waits)) if np.mean(waits) > 0 else 1.0
            std = float(np.std(waits))
            cv = std / mean if mean > 0 else 0.5
            rel_width = 0.2 + min(0.6, (cv * 0.4) + (1.0 / np.sqrt(len(waits))) * 0.4)
            rel_width = max(0.15, min(rel_width, 0.8))

        lower = max(0, estimate * (1 - rel_width))
        upper = estimate * (1 + rel_width)
        return round(lower, 2), round(upper, 2)

    def forecast_wait_time(self, store_data, current_queue_size, avg_service_time, historical_data=None):
        """Forecast wait time using pre-trained model"""
        try:
            store_type = self.get_store_category(store_data)
            
            if store_type not in self.models:
                return self.fallback_forecast(current_queue_size, avg_service_time, historical_data)
            
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
            
            confidence_lower, confidence_upper = self._compute_confidence_interval(
                final_forecast,
                historical_data
            )
            
            return {
                'forecasted_wait_time': round(final_forecast, 2),
                'arima_forecast': round(arima_forecast, 2),
                'queue_based': queue_based,
                'confidence_interval': {
                    'lower': confidence_lower,
                    'upper': confidence_upper
                },
                'method': 'pretrained_arima',
                'model_type': store_type,
                'model_mae': round(model_info['mae'], 2)
            }
            
        except Exception as e:
            print(f"Forecast error: {e}")
            return self.fallback_forecast(current_queue_size, avg_service_time, historical_data)
    
    def fallback_forecast(self, current_queue_size, avg_service_time, historical_data=None):
        """Simple fallback calculation"""
        estimated_wait = current_queue_size * avg_service_time
        confidence_lower, confidence_upper = self._compute_confidence_interval(
            estimated_wait,
            historical_data
        )
        
        return {
            'forecasted_wait_time': estimated_wait,
            'arima_forecast': estimated_wait,
            'queue_based': estimated_wait,
            'confidence_interval': {
                'lower': confidence_lower,
                'upper': confidence_upper
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
        historical_data = data.get('historicalData', [])
        
        forecast_result = forecaster.forecast_wait_time(
            store_data,
            current_queue_size,
            avg_service_time,
            historical_data
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

@app.route('/retrain', methods=['POST'])
def retrain():
    try:
        subprocess.Popen(['python', 'train_arima_model.py'], cwd=os.path.dirname(__file__))
        return jsonify({
            'success': True,
            'message': 'Retrain started'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

@app.route('/model-info', methods=['GET'])
def model_info():
    try:
        metadata_path = os.path.join(os.path.dirname(__file__), 'model_metadata.json')
        if not os.path.exists(metadata_path):
            return jsonify({
                'success': False,
                'message': 'model_metadata.json not found'
            }), 404
        with open(metadata_path, 'r') as f:
            metadata = f.read()
        return jsonify({
            'success': True,
            'data': metadata
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'message': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', '5000'))
    print("ARIMA Forecasting Service Starting...")
    print("Using pre-trained models")
    print(f"Service running on http://0.0.0.0:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
