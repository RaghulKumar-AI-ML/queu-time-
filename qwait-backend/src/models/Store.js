const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please provide store name'],
    trim: true,
    maxlength: [100, 'Store name cannot exceed 100 characters']
  },
  category: {
    type: String,
    required: [true, 'Please provide store category'],
    enum: ['retail', 'bank', 'hospital', 'restaurant', 'government', 'other']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
    country: {
      type: String,
      default: 'India'
    }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    }
  },
  phone: {
    type: String,
    required: [true, 'Please provide store phone number']
  },
  email: {
    type: String,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  operatingHours: {
    monday: { open: String, close: String },
    tuesday: { open: String, close: String },
    wednesday: { open: String, close: String },
    thursday: { open: String, close: String },
    friday: { open: String, close: String },
    saturday: { open: String, close: String },
    sunday: { open: String, close: String }
  },
  services: [{
    type: String
  }],
  avgServiceTime: {
    type: Number, // in minutes
    default: 15
  },
  maxQueueSize: {
    type: Number,
    default: 50
  },
  autoThrottleEnabled: {
    type: Boolean,
    default: true
  },
  autoThrottleLimit: {
    type: Number,
    default: 0
  },
  priorityRules: [{
    type: String
  }],
  counters: {
    type: Number,
    default: 1
  },
  activeCounters: {
    type: Number,
    default: 1
  },
  currentQueueSize: {
    type: Number,
    default: 0
  },
  images: [{
    type: String
  }],
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create geospatial index
storeSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Store', storeSchema);
