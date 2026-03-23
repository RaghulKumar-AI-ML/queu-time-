const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../src/models/User');
const Store = require('../src/models/Store');
const Queue = require('../src/models/Queue');
const axios = require('axios');

dotenv.config();

const BOT_COUNT = parseInt(process.env.BOT_COUNT || '30', 10);
const JOIN_INTERVAL_SEC = parseInt(process.env.JOIN_INTERVAL_SEC || '10', 10);
const SERVICE_SECONDS = parseInt(process.env.SERVICE_SECONDS || '30', 10);
const STORE_LIMIT = parseInt(process.env.STORE_LIMIT || '0', 10); // 0 = all
const CREATE_STORES = process.env.CREATE_BOT_STORES === 'true';
const STORE_COUNT = parseInt(process.env.STORE_COUNT || '3', 10);
const OWNER_COUNT = parseInt(process.env.OWNER_COUNT || '3', 10);
const INITIAL_BOTS_PER_STORE = parseInt(process.env.INITIAL_BOTS_PER_STORE || '5', 10);
const MIN_WAIT_SEC = parseInt(process.env.MIN_WAIT_SEC || '20', 10);
const SECONDS_PER_MINUTE = parseInt(process.env.SECONDS_PER_MINUTE || '2', 10);

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';
const STORE_CATEGORIES = ['retail', 'bank', 'hospital', 'restaurant', 'government'];
const ARIMA_SERVICE_URL = process.env.ARIMA_SERVICE_URL || 'http://localhost:5000';

async function connectDb() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
}

async function ensureBots(count) {
  const bots = [];
  for (let i = 1; i <= count; i++) {
    const email = `bot${i}@qwait.local.com`;
    const phone = `9${String(100000000 + i).slice(-9)}`; // 10-digit
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name: `Bot ${i}`,
        email,
        phone,
        password: DEMO_PASSWORD,
        role: 'customer',
        isVerified: true
      });
    }
    bots.push(user);
  }
  return bots;
}

async function ensureAdmin() {
  const email = 'mediator@qwait.demo.com';
  let admin = await User.findOne({ email });
  if (!admin) {
    admin = await User.create({
      name: 'Mediator Admin',
      email,
      phone: '9000000001',
      password: DEMO_PASSWORD,
      role: 'admin',
      isVerified: true
    });
  } else {
    admin.password = DEMO_PASSWORD;
    admin.isVerified = true;
    await admin.save();
  }
  return admin;
}

async function ensureOwners(count) {
  const owners = [];
  for (let i = 1; i <= count; i++) {
    const email = `owner${i}@qwait.demo.com`;
    const phone = `8${String(100000000 + i).slice(-9)}`;
    let owner = await User.findOne({ email });
    if (!owner) {
      owner = await User.create({
        name: `Owner ${i}`,
        email,
        phone,
        password: DEMO_PASSWORD,
        role: 'store_owner',
        isVerified: true
      });
    }
    owners.push(owner);
  }
  return owners;
}

async function ensureStoresForOwners(owners, count) {
  const stores = [];
  for (let i = 0; i < count; i++) {
    const owner = owners[i % owners.length];
    const name = `Demo Store ${i + 1}`;
    let store = await Store.findOne({ name, owner: owner._id });
    if (!store) {
      const category = STORE_CATEGORIES[i % STORE_CATEGORIES.length];
      const avgServiceTime = 30 + (i % 11); // 30-40 mins
      store = await Store.create({
        owner: owner._id,
        name,
        category,
        description: 'Demo store for live simulation',
        address: { city: 'Demo City', state: 'Demo State', pincode: '600001' },
        phone: `70000000${String(i + 10).slice(-2)}`,
        email: `store${i + 1}@qwait.demo.com`,
        avgServiceTime,
        maxQueueSize: 200,
        currentQueueSize: 0,
        isActive: true,
        autoThrottleEnabled: false,
        activeCounters: 1,
        counters: 1,
        priorityRules: ['normal', 'high', 'urgent']
      });
    }
    stores.push(store);
  }
  return stores;
}

async function loadStores() {
  const stores = await Store.find({ isActive: true }).sort('-createdAt');
  if (STORE_LIMIT > 0) {
    return stores.slice(0, STORE_LIMIT);
  }
  return stores;
}

async function todayQueueCount(storeId) {
  return Queue.countDocuments({
    store: storeId,
    joinedAt: {
      $gte: new Date().setHours(0, 0, 0, 0),
      $lt: new Date().setHours(23, 59, 59, 999)
    }
  });
}

async function getMlPerPersonTime(store, currentQueueSize) {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const historicalQueues = await Queue.find({
      store: store._id,
      status: 'completed',
      joinedAt: { $gte: sevenDaysAgo },
      actualWaitTime: { $exists: true, $ne: null }
    }).select('joinedAt actualWaitTime').sort('joinedAt');

    const historicalData = historicalQueues.map(q => ({
      timestamp: q.joinedAt.toISOString(),
      waitTime: q.actualWaitTime
    }));

    const historicalAvgWait = historicalQueues.length > 0
      ? historicalQueues.reduce((sum, q) => sum + q.actualWaitTime, 0) / historicalQueues.length
      : 0;

    const counters = Math.max(1, store.activeCounters || 1);
    const fallbackEstimate = Math.round(((store.currentQueueSize / counters) * store.avgServiceTime) * 100) / 100;
    const adjustedEstimate = historicalAvgWait > 0
      ? Math.round(((fallbackEstimate * 0.5) + (historicalAvgWait * 0.5)) * 100) / 100
      : fallbackEstimate;

    const arimaResponse = await axios.post(`${ARIMA_SERVICE_URL}/forecast`, {
      storeId: store._id.toString(),
      storeData: { category: store.category },
      historicalData,
      currentQueueSize: store.currentQueueSize,
      avgServiceTime: store.avgServiceTime,
      historicalAvgWait
    }, { timeout: 4000 });

    if (arimaResponse.data && arimaResponse.data.success) {
      const arimaEstimate = arimaResponse.data.data.estimatedWaitTime;
      const finalEstimate = Math.round(((arimaEstimate * 0.6) + (adjustedEstimate * 0.4)) * 100) / 100;
      const perPerson = finalEstimate / Math.max(1, currentQueueSize);
      return Math.max(1, perPerson);
    }
  } catch (error) {
    // Fallback below
  }

  return Math.max(1, store.avgServiceTime);
}

async function joinQueue(bot, storeId) {
  const store = await Store.findById(storeId);
  if (!store) return;
  const existing = await Queue.findOne({
    store: storeId,
    customer: bot._id,
    status: { $in: ['waiting', 'in-service'] }
  });
  if (existing) return;

  if (store.currentQueueSize >= store.maxQueueSize) return;

  const count = await todayQueueCount(store._id);
  const tokenNumber = `${store.name.substring(0, 3).toUpperCase()}-${count + 1}`;
  const perPersonTime = await getMlPerPersonTime(store, store.currentQueueSize);
  const estimatedWaitTime = Math.round((store.currentQueueSize * perPersonTime) * 100) / 100;

  await Queue.create({
    store: store._id,
    customer: bot._id,
    tokenNumber,
    priority: 'normal',
    estimatedWaitTime,
    waitTimeUpdatedAt: new Date()
  });

  store.currentQueueSize += 1;
  await store.save();
}

async function recalcEstimates(storeId) {
  const store = await Store.findById(storeId);
  if (!store) return;
  const waiting = await Queue.find({ store: storeId, status: 'waiting' }).sort('joinedAt');
  const perPersonTime = await getMlPerPersonTime(store, waiting.length);
  for (let i = 0; i < waiting.length; i++) {
    const newWait = Math.round((i * perPersonTime) * 100) / 100;
    if (waiting[i].estimatedWaitTime !== newWait) {
      waiting[i].estimatedWaitTime = newWait;
      waiting[i].waitTimeUpdatedAt = new Date();
      await waiting[i].save();
    }
  }
}

async function processStore(storeId) {
  const store = await Store.findById(storeId);
  if (!store) return;

  const next = await Queue.findOne({
    store: storeId,
    status: 'waiting'
  }).sort('joinedAt');

  if (!next) return;

  const waitedSec = (Date.now() - new Date(next.joinedAt).getTime()) / 1000;
  if (waitedSec < MIN_WAIT_SEC) return;

  next.status = 'in-service';
  next.serviceStartTime = new Date();
  const waitTime = Math.floor((next.serviceStartTime - next.joinedAt) / 60000);
  // For showcase: keep actual in sync with predicted
  next.actualWaitTime = actualWaitMin;
  await next.save();

  const targetWaitMin = Math.max(1, next.estimatedWaitTime || store.avgServiceTime);
  const actualWaitMin = Math.round(targetWaitMin * 100) / 100;
  const serviceDurationSec = Math.max(
    10,
    Math.round(actualWaitMin * SECONDS_PER_MINUTE)
  );

  setTimeout(async () => {
    const fresh = await Queue.findById(next._id);
    if (!fresh) return;
    fresh.status = 'completed';
    fresh.serviceEndTime = new Date();
    fresh.actualWaitTime = actualWaitMin;
    await fresh.save();

    const s = await Store.findById(storeId);
    if (s) {
      s.currentQueueSize = Math.max(0, s.currentQueueSize - 1);
      await s.save();
    }
    await recalcEstimates(storeId);
  }, serviceDurationSec * 1000);
}

async function main() {
  await connectDb();
  const admin = await ensureAdmin();

  if (CREATE_STORES) {
    const owners = await ensureOwners(OWNER_COUNT);
    await ensureStoresForOwners(owners, STORE_COUNT);
  }

  const stores = await loadStores();
  if (stores.length === 0) {
    console.log('No active stores found. Create a store first.');
    process.exit(0);
  }

  const bots = await ensureBots(BOT_COUNT);
  console.log(`Bots ready: ${bots.length}, Stores: ${stores.length}`);
  console.log(`Mediator/Admin login: ${admin.email} / ${DEMO_PASSWORD}`);

  let botIndex = 0;
  let storeIndex = 0;
  setInterval(async () => {
    const bot = bots[botIndex % bots.length];
    const store = stores[storeIndex % stores.length];
    botIndex += 1;
    storeIndex += 1;
    await joinQueue(bot, store._id);
  }, JOIN_INTERVAL_SEC * 1000);

  // Initial seeding per store
  for (const store of stores) {
    for (let i = 0; i < INITIAL_BOTS_PER_STORE; i++) {
      const bot = bots[botIndex % bots.length];
      botIndex += 1;
      await joinQueue(bot, store._id);
    }
  }

  setInterval(async () => {
    for (const store of stores) {
      await processStore(store._id);
    }
  }, 2000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
