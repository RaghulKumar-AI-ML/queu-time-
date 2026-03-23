const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Store = require('../src/models/Store');
const Queue = require('../src/models/Queue');

dotenv.config();

const LIMIT = parseInt(process.env.REPORT_LIMIT || '20', 10);
const STORE_ID = process.env.STORE_ID || '';

function pad(str, len) {
  return String(str).padEnd(len, ' ');
}

function formatTime(d) {
  const date = new Date(d);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function asciiGraph(series) {
  if (!series.length) return 'No data to plot.';
  const maxY = Math.max(...series.map(p => Math.max(p.predicted, p.actual)), 1);
  const rows = 10;
  const cols = series.length;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));

  series.forEach((p, i) => {
    const yPred = Math.round((p.predicted / maxY) * (rows - 1));
    const yAct = Math.round((p.actual / maxY) * (rows - 1));
    grid[rows - 1 - yPred][i] = 'P';
    grid[rows - 1 - yAct][i] = grid[rows - 1 - yAct][i] === 'P' ? 'X' : 'A';
  });

  let out = '\nPredicted (P) vs Actual (A)\n';
  for (let r = 0; r < rows; r++) {
    const level = Math.round((maxY * (rows - 1 - r)) / (rows - 1));
    out += pad(level, 3) + ' | ' + grid[r].join(' ') + '\n';
  }
  out += '    ' + '-'.repeat(cols * 2) + '\n';
  out += '     ' + series.map((_, i) => ((i + 1) % 10)).join(' ') + '\n';
  return out;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  let store = null;
  if (STORE_ID) {
    store = await Store.findById(STORE_ID);
  } else {
    store = await Store.findOne({}).sort('-createdAt');
  }

  if (!store) {
    console.log('No store found.');
    await mongoose.disconnect();
    return;
  }

  const queues = await Queue.find({
    store: store._id,
    status: 'completed',
    actualWaitTime: { $exists: true, $ne: null },
    estimatedWaitTime: { $exists: true, $ne: null }
  }).select('joinedAt estimatedWaitTime actualWaitTime').sort('-joinedAt').limit(LIMIT);

  const series = queues.reverse().map(q => ({
    time: q.joinedAt,
    predicted: q.estimatedWaitTime,
    actual: q.actualWaitTime
  }));

  if (series.length === 0) {
    console.log('No completed queue data yet.');
    await mongoose.disconnect();
    return;
  }

  const errors = series.map(p => p.actual - p.predicted);
  const mae = errors.reduce((s, e) => s + Math.abs(e), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((s, e) => s + (e * e), 0) / errors.length);
  const mape = series.reduce((s, p) => p.actual === 0 ? s : s + (Math.abs(p.actual - p.predicted) / p.actual), 0) / errors.length * 100;
  const accuracy = Math.max(0, 100 - mape);

  console.log(`Store: ${store.name} (${store._id})`);
  console.log(`Samples: ${series.length}`);
  console.log(`MAE: ${mae.toFixed(2)} min, RMSE: ${rmse.toFixed(2)} min, MAPE: ${mape.toFixed(2)}%, Accuracy: ${accuracy.toFixed(2)}%`);
  console.log('\nTIME                ARIMA_PRED  ACTUAL  ERROR');
  series.forEach(p => {
    const err = (p.actual - p.predicted).toFixed(2);
    console.log(`${pad(formatTime(p.time), 19)}  ${pad(p.predicted.toFixed(2), 9)}  ${pad(p.actual.toFixed(2), 6)}  ${err}`);
  });

  console.log(asciiGraph(series));
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
