const mongoose = require('mongoose');

const queueSchema = new mongoose.Schema({
  store: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Store',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tokenNumber: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['waiting', 'in-service', 'completed', 'cancelled', 'no-show'],
    default: 'waiting'
  },
  priority: {
    type: String,
    enum: ['normal', 'high', 'urgent'],
    default: 'normal'
  },
  serviceType: {
    type: String
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  estimatedWaitTime: {
    type: Number, // in minutes
    required: true
  },
  actualWaitTime: {
    type: Number // in minutes
  },
  serviceStartTime: {
    type: Date
  },
  serviceEndTime: {
    type: Date
  },
  notes: {
    type: String,
    maxlength: [200, 'Notes cannot exceed 200 characters']
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  feedback: {
    type: String,
    maxlength: [500, 'Feedback cannot exceed 500 characters']
  }
});

// Create compound index for store and status
queueSchema.index({ store: 1, status: 1 });

// Create index for customer
queueSchema.index({ customer: 1 });

module.exports = mongoose.model('Queue', queueSchema);


