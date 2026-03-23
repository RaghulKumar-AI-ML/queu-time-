const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const socketIO = require('socket.io');
const connectDatabase = require('./config/database');
const { processScheduledQueues, processNoShows, getNoShowEnabled } = require('./controllers/queueController');

// Import routes
const storeRoutes = require('./routes/storeRoutes');
const authRoutes = require('./routes/authRoutes');
const queueRoutes = require('./routes/queueRoutes');
const forecastRoutes = require('./routes/forecastRoutes');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = socketIO(server, {
  cors: {
    origin: "*", // Allow all origins for local network access
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Make io accessible to routes
app.set('io', io);

// Connect to Database
connectDatabase();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Background scheduler for scheduled queues and no-shows
let schedulerRunning = false;
setInterval(async () => {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    await processScheduledQueues(io);
    if (getNoShowEnabled()) {
      await processNoShows(io);
    }
  } catch (error) {
    console.error('Scheduler error:', error);
  } finally {
    schedulerRunning = false;
  }
}, 60 * 1000);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // Join store-specific room
  socket.on('joinStore', (storeId) => {
    socket.join(`store-${storeId}`);
    console.log(`👤 Client ${socket.id} joined store-${storeId}`);
  });

  // Leave store room
  socket.on('leaveStore', (storeId) => {
    socket.leave(`store-${storeId}`);
    console.log(`👋 Client ${socket.id} left store-${storeId}`);
  });

  // Join personal queue room
  socket.on('joinQueue', (queueId) => {
    socket.join(`queue-${queueId}`);
    console.log(`🎫 Client ${socket.id} joined queue-${queueId}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Basic route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Q-Wait API is running! 🚀',
    version: '1.0.0',
    realtime: 'Socket.IO enabled'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is healthy',
    timestamp: new Date().toISOString(),
    socketConnections: io.engine.clientsCount
  });
});

// Mount routes
app.use('/api/stores', storeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/queues', queueRoutes);
app.use('/api/forecast', forecastRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server is running on ${HOST}:${PORT}`);
  console.log(`🔍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🌐 API URL: http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO enabled for real-time updates`);
  console.log(`📱 Access from network: http://<your-ip>:${PORT}`);
});

module.exports = { app, io };
