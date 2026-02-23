// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate OTP expiry time (10 minutes from now)
const generateOTPExpiry = () => {
  return Date.now() + 10 * 60 * 1000; // 10 minutes
};

// Verify OTP
const verifyOTP = (storedOTP, enteredOTP, otpExpiry) => {
  if (!storedOTP || !otpExpiry) {
    return { success: false, message: 'OTP not found' };
  }

  if (Date.now() > otpExpiry) {
    return { success: false, message: 'OTP has expired' };
  }

  if (storedOTP !== enteredOTP) {
    return { success: false, message: 'Invalid OTP' };
  }

  return { success: true, message: 'OTP verified successfully' };
};

module.exports = {
  generateOTP,
  generateOTPExpiry,
  verifyOTP
};