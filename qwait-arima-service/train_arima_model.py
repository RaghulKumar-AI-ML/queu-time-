import pandas as pd
import numpy as np
from statsmodels.tsa.arima.model import ARIMA
import pickle
import warnings
warnings.filterwarnings('ignore')

class ARIMAModelTrainer:
    """Train ARIMA models for each store type"""
    
    def __init__(self, data_file='queue_training_data_90days.csv'):
        print("📂 Loading dataset...")
        self.df = pd.read_csv(data_file)
        self.df['timestamp'] = pd.to_datetime(self.df['timestamp'])
        
        # Filter only completed records with actual wait times
        print(f"   Total records: {len(self.df):,}")
        self.df = self.df[self.df['status'] == 'completed'].copy()
        self.df = self.df[self.df['actual_wait_time'].notna()]
        print(f"   Usable records (completed): {len(self.df):,}")
        
        self.models = {}
        
    def prepare_data(self, store_type):
        """Prepare time series data for specific store type"""
        store_data = self.df[self.df['store_type'] == store_type].copy()
        store_data = store_data.sort_values('timestamp')
        store_data = store_data.set_index('timestamp')
        
        # Use actual_wait_time column (not wait_time)
        ts = store_data['actual_wait_time'].resample('H').mean()
        ts = ts.fillna(method='ffill').fillna(method='bfill')
        
        return ts
    
    def train_model(self, store_type, order=(2, 1, 2)):
        """Train ARIMA model for specific store type"""
        print(f"\n🔧 Training ARIMA model for {store_type}...")
        
        try:
            # Prepare data
            ts = self.prepare_data(store_type)
            
            # Split data: 80% train, 20% test
            train_size = int(len(ts) * 0.8)
            train_data = ts[:train_size]
            test_data = ts[train_size:]
            
            print(f"   Training samples: {len(train_data)}")
            print(f"   Testing samples: {len(test_data)}")
            
            # Train ARIMA model
            model = ARIMA(train_data, order=order)
            fitted_model = model.fit()
            
            # Evaluate on test data
            predictions = fitted_model.forecast(steps=len(test_data))
            mae = np.mean(np.abs(predictions - test_data))
            rmse = np.sqrt(np.mean((predictions - test_data) ** 2))
            
            print(f"   ✅ Model trained successfully!")
            print(f"   MAE: {mae:.2f} minutes")
            print(f"   RMSE: {rmse:.2f} minutes")
            
            # Store model
            self.models[store_type] = {
                'model': fitted_model,
                'order': order,
                'mae': mae,
                'rmse': rmse,
                'last_values': train_data.tail(50).values  # Store last 50 values for forecasting
            }
            
            return fitted_model, mae, rmse
            
        except Exception as e:
            print(f"   ❌ Error training {store_type}: {str(e)}")
            return None, None, None
    
    def train_all_models(self):
        """Train models for all store types"""
        print("🚀 Starting ARIMA training for all store types...")
        print("=" * 60)
        
        store_types = self.df['store_type'].unique()
        
        for store_type in store_types:
            self.train_model(store_type)
        
        print("\n" + "=" * 60)
        print("✅ All models trained successfully!")
        
    def save_models(self, output_file='trained_arima_models.pkl'):
        """Save all trained models to file"""
        print(f"\n💾 Saving models to {output_file}...")
        
        # Prepare data for saving
        save_data = {
            'models': {},
            'metadata': {
                'training_date': pd.Timestamp.now().isoformat(),
                'total_records': len(self.df),
                'store_types': list(self.models.keys())
            }
        }
        
        for store_type, model_info in self.models.items():
            save_data['models'][store_type] = {
                'model': model_info['model'],
                'order': model_info['order'],
                'mae': model_info['mae'],
                'rmse': model_info['rmse'],
                'last_values': model_info['last_values']
            }
        
        # Save to pickle file
        with open(output_file, 'wb') as f:
            pickle.dump(save_data, f)
        
        print(f"✅ Models saved successfully!")
        
        # Save metadata as JSON
        import json
        metadata = {
            'training_date': save_data['metadata']['training_date'],
            'total_records': save_data['metadata']['total_records'],
            'store_types': save_data['metadata']['store_types'],
            'model_performance': {
                store: {
                    'mae': float(info['mae']),
                    'rmse': float(info['rmse']),
                    'order': info['order']
                }
                for store, info in save_data['models'].items()
            }
        }
        
        with open('model_metadata.json', 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print("📊 Model metadata saved to model_metadata.json")
    
    def test_prediction(self, store_type='bank', steps=3):
        """Test prediction for a store type"""
        print(f"\n🧪 Testing prediction for {store_type} (next {steps} hours)...")
        
        if store_type not in self.models:
            print(f"❌ No model found for {store_type}")
            return
        
        model_info = self.models[store_type]
        model = model_info['model']
        
        # Make prediction
        forecast = model.forecast(steps=steps)
        
        print(f"Predictions for next {steps} hours:")
        for i, pred in enumerate(forecast, 1):
            print(f"   Hour {i}: {pred:.2f} minutes")
        
        return forecast

if __name__ == "__main__":
    print("🚀 Q-Wait ARIMA Model Training")
    print("=" * 60)
    
    # Initialize trainer
    trainer = ARIMAModelTrainer()
    
    # Train all models
    trainer.train_all_models()
    
    # Save models
    trainer.save_models()
    
    # Test predictions
    print("\n" + "=" * 60)
    print("🧪 Testing Predictions")
    print("=" * 60)
    trainer.test_prediction('bank', steps=3)
    trainer.test_prediction('hospital', steps=3)
    
    print("\n✅ Training complete!")
    print("📁 Files created:")
    print("   - trained_arima_models.pkl (trained models)")
    print("   - model_metadata.json (model information)")