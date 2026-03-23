const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../src/models/User');

dotenv.config();

const EMAIL = process.env.ADMIN_EMAIL || 'mediator@qwait.demo.com';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  let admin = await User.findOne({ email: EMAIL });
  if (!admin) {
    admin = await User.create({
      name: 'Mediator Admin',
      email: EMAIL,
      phone: '9000000001',
      password: PASSWORD,
      role: 'admin',
      isVerified: true
    });
    console.log('Admin created');
  } else {
    admin.password = PASSWORD;
    admin.isVerified = true;
    await admin.save();
    console.log('Admin password reset');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
