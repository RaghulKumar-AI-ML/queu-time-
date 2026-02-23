const express = require('express');
const router = express.Router();
const {
  signup,
  verifyOTPController,
  login,
  getMe,
  resendOTP
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/signup', signup);
router.post('/verify-otp', verifyOTPController);
router.post('/login', login);
router.post('/resend-otp', resendOTP);

// Protected routes
router.get('/me', protect, getMe);

module.exports = router;