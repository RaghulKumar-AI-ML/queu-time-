import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import random

class InstantDatasetGenerator:
    """Generate 90 days of realistic queue data - Ready to train!"""
    
    def __init__(self):
        # Store configurations with realistic patterns
        self.store_configs = {
            'bank': {
                'base_wait': 25,
                'variance': 10,
                'peak_hours': [9, 10, 11, 16, 17],
                'weekend_closed': True,
                'avg_service_time': 12,
                'typical_queue': 4
            },
            'hospital': {
                'base_wait': 45,
                'variance': 20,
                'peak_hours': [8, 9, 10, 14, 15, 16],
                'weekend_closed': False,
                'avg_service_time': 20,
                'typical_queue': 8
            },
            'retail': {
                'base_wait': 18,
                'variance': 8,
                'peak_hours': [11, 12, 13, 17, 18, 19, 20],
                'weekend_closed': False,
                'avg_service_time': 10,
                'typical_queue': 5
            },
            'restaurant': {
                'base_wait': 30,
                'variance': 12,
                'peak_hours': [12, 13, 14, 19, 20, 21],
                'weekend_closed': False,
                'avg_service_time': 15,
                'typical_queue': 6
            },
            'government': {
                'base_wait': 50,
                'variance': 18,
                'peak_hours': [10, 11, 14, 15],
                'weekend_closed': True,
                'avg_service_time': 25,
                'typical_queue': 7
            }
        }
    
    def generate_complete_dataset(self, days=90):
        """Generate complete dataset with all features"""
        print(f"🚀 Generating {days} days of queue data...")
        print("=" * 70)
        
        all_records = []
        start_date = datetime.now() - timedelta(days=days)
        
        total_records = 0
        
        for store_type, config in self.store_configs.items():
            print(f"\n📊 Generating {store_type.upper()} data...")
            store_records = 0
            
            for day in range(days):
                current_date = start_date + timedelta(days=day)
                is_weekend = current_date.weekday() >= 5
                
                # Skip if closed on weekends
                if is_weekend and config['weekend_closed']:
                    continue
                
                # Operating hours: 8 AM to 8 PM
                for hour in range(8, 21):
                    # Number of customers per hour (varies by hour)
                    if hour in config['peak_hours']:
                        customers_per_hour = random.randint(4, 8)
                    else:
                        customers_per_hour = random.randint(1, 4)
                    
                    # Weekend adjustment
                    if is_weekend and not config['weekend_closed']:
                        if store_type in ['retail', 'restaurant']:
                            customers_per_hour = int(customers_per_hour * 1.3)
                        else:
                            customers_per_hour = max(1, int(customers_per_hour * 0.7))
                    
                    # Generate individual customer records
                    for customer in range(customers_per_hour):
                        timestamp = current_date.replace(
                            hour=hour,
                            minute=random.randint(0, 55),
                            second=random.randint(0, 59)
                        )
                        
                        # Calculate queue size at this time
                        base_queue = config['typical_queue']
                        if hour in config['peak_hours']:
                            queue_size = base_queue + random.randint(2, 6)
                        else:
                            queue_size = max(0, base_queue + random.randint(-2, 2))
                        
                        # Calculate wait time with multiple factors
                        base_wait = config['base_wait']
                        
                        # Peak hour multiplier
                        if hour in config['peak_hours']:
                            base_wait *= random.uniform(1.4, 1.9)
                        
                        # Queue size impact
                        queue_impact = queue_size * (config['avg_service_time'] * 0.8)
                        
                        # Time of day factor
                        if hour < 10:  # Morning
                            time_factor = 1.1
                        elif 12 <= hour <= 14:  # Lunch
                            time_factor = 1.3
                        elif 17 <= hour <= 19:  # Evening
                            time_factor = 1.2
                        else:
                            time_factor = 1.0
                        
                        # Weekend factor
                        weekend_factor = 1.15 if is_weekend else 1.0
                        
                        # Calculate final wait time
                        wait_time = (base_wait * time_factor * weekend_factor + 
                                   queue_impact + 
                                   random.gauss(0, config['variance']))
                        
                        # Ensure positive and realistic
                        wait_time = max(3, min(wait_time, 180))
                        
                        # Actual service time (with variance)
                        actual_service_time = config['avg_service_time'] + random.randint(-3, 5)
                        actual_service_time = max(3, actual_service_time)
                        
                        # Priority (10% high priority)
                        priority = 'high' if random.random() < 0.1 else 'normal'
                        if priority == 'high':
                            wait_time *= 0.7  # High priority waits less
                        
                        # Service type
                        service_types = {
                            'bank': ['withdrawal', 'deposit', 'loan', 'account'],
                            'hospital': ['consultation', 'emergency', 'checkup', 'lab'],
                            'retail': ['billing', 'exchange', 'inquiry', 'checkout'],
                            'restaurant': ['dine-in', 'takeaway', 'reservation', 'delivery'],
                            'government': ['license', 'permit', 'registration', 'certificate']
                        }
                        service_type = random.choice(service_types[store_type])
                        
                        # Status (95% completed, 5% cancelled/no-show)
                        rand = random.random()
                        if rand < 0.95:
                            status = 'completed'
                        elif rand < 0.98:
                            status = 'cancelled'
                        else:
                            status = 'no-show'
                        
                        # Only calculate actual wait if completed
                        if status == 'completed':
                            # Actual wait time (close to estimated but with variance)
                            actual_wait_time = wait_time + random.gauss(0, 5)
                            actual_wait_time = max(2, actual_wait_time)
                        else:
                            actual_wait_time = None
                            actual_service_time = None
                        
                        # Customer satisfaction (based on wait time)
                        if status == 'completed':
                            if actual_wait_time < 15:
                                satisfaction = random.randint(4, 5)
                            elif actual_wait_time < 30:
                                satisfaction = random.randint(3, 5)
                            elif actual_wait_time < 60:
                                satisfaction = random.randint(2, 4)
                            else:
                                satisfaction = random.randint(1, 3)
                        else:
                            satisfaction = None
                        
                        record = {
                            'timestamp': timestamp,
                            'store_type': store_type,
                            'queue_size': queue_size,
                            'estimated_wait_time': round(wait_time, 2),
                            'actual_wait_time': round(actual_wait_time, 2) if actual_wait_time else None,
                            'service_time': actual_service_time,
                            'avg_service_time': config['avg_service_time'],
                            'hour': hour,
                            'day_of_week': current_date.strftime('%A'),
                            'day_of_month': current_date.day,
                            'month': current_date.month,
                            'is_weekend': is_weekend,
                            'is_peak_hour': hour in config['peak_hours'],
                            'priority': priority,
                            'service_type': service_type,
                            'status': status,
                            'customer_satisfaction': satisfaction,
                            'date': current_date.strftime('%Y-%m-%d')
                        }
                        
                        all_records.append(record)
                        store_records += 1
                        total_records += 1
            
            print(f"   ✅ Generated {store_records:,} records for {store_type}")
        
        # Create DataFrame
        df = pd.DataFrame(all_records)
        
        # Sort by timestamp
        df = df.sort_values('timestamp').reset_index(drop=True)
        
        print("\n" + "=" * 70)
        print(f"✅ COMPLETE! Generated {total_records:,} total records")
        
        return df
    
    def save_dataset(self, df, filename='queue_training_data_90days.csv'):
        """Save dataset to CSV"""
        df.to_csv(filename, index=False)
        print(f"\n💾 Dataset saved to: {filename}")
        print(f"📊 File size: {len(df):,} rows × {len(df.columns)} columns")
        
    def show_statistics(self, df):
        """Show dataset statistics"""
        print("\n" + "=" * 70)
        print("📈 DATASET STATISTICS")
        print("=" * 70)
        
        print(f"\n🗓️  Date Range:")
        print(f"   From: {df['timestamp'].min()}")
        print(f"   To:   {df['timestamp'].max()}")
        print(f"   Days: {(df['timestamp'].max() - df['timestamp'].min()).days}")
        
        print(f"\n🏪 Records by Store Type:")
        for store_type, count in df['store_type'].value_counts().items():
            pct = (count / len(df)) * 100
            print(f"   {store_type:12s}: {count:6,} records ({pct:5.1f}%)")
        
        print(f"\n⏱️  Wait Time Statistics:")
        print(f"   Average:    {df['estimated_wait_time'].mean():.2f} minutes")
        print(f"   Median:     {df['estimated_wait_time'].median():.2f} minutes")
        print(f"   Min:        {df['estimated_wait_time'].min():.2f} minutes")
        print(f"   Max:        {df['estimated_wait_time'].max():.2f} minutes")
        print(f"   Std Dev:    {df['estimated_wait_time'].std():.2f} minutes")
        
        print(f"\n👥 Queue Statistics:")
        print(f"   Average Queue Size: {df['queue_size'].mean():.2f} people")
        print(f"   Max Queue Size:     {df['queue_size'].max()} people")
        
        print(f"\n📊 Status Distribution:")
        for status, count in df['status'].value_counts().items():
            pct = (count / len(df)) * 100
            print(f"   {status:12s}: {count:6,} ({pct:5.1f}%)")
        
        print(f"\n⭐ Customer Satisfaction (completed only):")
        completed = df[df['status'] == 'completed']
        if 'customer_satisfaction' in completed.columns:
            print(f"   Average Rating: {completed['customer_satisfaction'].mean():.2f}/5.0")
        
        print(f"\n🔥 Peak Hour Analysis:")
        peak_data = df[df['is_peak_hour'] == True]
        print(f"   Peak hour records: {len(peak_data):,} ({len(peak_data)/len(df)*100:.1f}%)")
        print(f"   Avg wait (peak):   {peak_data['estimated_wait_time'].mean():.2f} min")
        print(f"   Avg wait (normal): {df[df['is_peak_hour']==False]['estimated_wait_time'].mean():.2f} min")
        
        print("\n" + "=" * 70)
        
    def show_preview(self, df, rows=10):
        """Show dataset preview"""
        print(f"\n📋 DATASET PREVIEW (first {rows} rows):")
        print("=" * 70)
        print(df.head(rows).to_string())
        print("\n" + "=" * 70)

if __name__ == "__main__":
    print("🚀 Q-WAIT 90-DAY TRAINING DATASET GENERATOR")
    print("=" * 70)
    print("Creating production-ready dataset with realistic patterns...")
    print()
    
    # Initialize generator
    generator = InstantDatasetGenerator()
    
    # Generate dataset
    df = generator.generate_complete_dataset(days=90)
    
    # Save to CSV
    generator.save_dataset(df)
    
    # Show statistics
    generator.show_statistics(df)
    
    # Show preview
    generator.show_preview(df, rows=15)
    
    print("\n✅ READY TO USE!")
    print("📁 File: queue_training_data_90days.csv")
    print("🎯 Next step: Run 'python train_arima_model.py' to train models")
    print("\n" + "=" * 70)