import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

// 🌐 NETWORK CONFIGURATION
// For localhost: Use 'localhost'
// For other devices: Replace with your IP (run: python get_network_ip.py)
// Example: const API_BASE = 'http://192.168.1.5:3000';
const API_BASE = 'http://localhost:3000';
const API_URL = `${API_BASE}/api`;
const PEOPLE_COUNTER_URL = 'http://localhost:5001';



// 🔌 Socket.IO Connection
let socket = null;

// API Helper
const api = {
  signup: (data) => fetch(`${API_URL}/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  verifyOTP: (data) => fetch(`${API_URL}/auth/verify-otp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  login: (data) => fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  getStores: (category) => fetch(`${API_URL}/stores${category ? `?category=${category}` : ''}`),
  getMyStores: (token) => fetch(`${API_URL}/stores/my/stores`, { headers: { 'Authorization': `Bearer ${token}` } }),
  createStore: (data, token) => fetch(`${API_URL}/stores`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) }),
  joinQueue: (data, token) => fetch(`${API_URL}/queues/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) }),
  joinQueueLater: (data, token) => fetch(`${API_URL}/queues/join-later`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) }),
  withdrawQueue: (queueId, token) => fetch(`${API_URL}/queues/${queueId}/withdraw`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }),
  getMyQueues: (token) => fetch(`${API_URL}/queues/my-queues`, { headers: { 'Authorization': `Bearer ${token}` } }),
  getStoreQueue: (storeId, token) => fetch(`${API_URL}/queues/store/${storeId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  updateStatus: (queueId, status, token) => fetch(`${API_URL}/queues/${queueId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ status }) }),
  callNext: (storeId, token) => fetch(`${API_URL}/queues/store/${storeId}/call-next`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({}) }),
  getForecast: (storeId) => fetch(`${API_URL}/forecast/wait-time`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId }) }),
  getSLAStats: (storeId, period, token) => fetch(`${API_URL}/forecast/sla/${storeId}?period=${period}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  getQueueAnalytics: (storeId, days, token) => fetch(`${API_URL}/queues/store/${storeId}/analytics?days=${days}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  retrainModels: (token) => fetch(`${API_URL}/forecast/retrain`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }),
  getModelInfo: (token) => fetch(`${API_URL}/forecast/model-info`, { headers: { 'Authorization': `Bearer ${token}` } }),
  getModelPerformance: (storeId, days, token) => fetch(`${API_URL}/forecast/model-performance/${storeId}?days=${days}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  getPredictionSeries: (storeId, limit, token) => fetch(`${API_URL}/forecast/prediction-series/${storeId}?limit=${limit}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  getAdminStores: (token) => fetch(`${API_URL}/stores/admin/all`, { headers: { 'Authorization': `Bearer ${token}` } }),
  updateStoreAdmin: (storeId, data, token) => fetch(`${API_URL}/stores/admin/${storeId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) }),
  getAdminLiveQueues: (storeId, token) => fetch(`${API_URL}/queues/admin/live${storeId ? `?storeId=${storeId}` : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  exportQueuesCsv: (storeId, token) => fetch(`${API_URL}/queues/admin/export${storeId ? `?storeId=${storeId}` : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  getNoShowStatus: (token) => fetch(`${API_URL}/queues/admin/no-show/status`, { headers: { 'Authorization': `Bearer ${token}` } }),
  previewNoShows: (token) => fetch(`${API_URL}/queues/admin/no-show/preview`, { headers: { 'Authorization': `Bearer ${token}` } }),
  toggleNoShow: (enabled, token) => fetch(`${API_URL}/queues/admin/no-show/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ enabled }) }),
  runNoShow: (token) => fetch(`${API_URL}/queues/admin/no-show/run`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }),
  countPeople: (imageData, avgServiceTime) => fetch(`${PEOPLE_COUNTER_URL}/count-people`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageData, avgServiceTime }) })
};

// Main App
export default function QWaitApp() {
  const [page, setPage] = useState('home');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('token');
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
      setToken(savedToken);
      const role = JSON.parse(savedUser).role;
      setPage(role === 'store_owner' || role === 'admin' ? 'owner' : 'category-select');
    }
  }, []);

  const login = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', authToken);
    setPage(userData.role === 'store_owner' || userData.role === 'admin' ? 'owner' : 'category-select');
  };

  const logout = () => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    localStorage.clear();
    setUser(null);
    setToken(null);
    setPage('home');
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6' }}>
      <div style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '16px' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#4f46e5', cursor: 'pointer' }} onClick={() => setPage(user ? (user.role === 'store_owner' || user.role === 'admin' ? 'owner' : 'category-select') : 'home')}>Q-Wait 🔌</h1>
          {user ? (
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <span>{user.name}</span>
              <button onClick={logout} style={{ padding: '8px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Logout</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setPage('login')} style={{ padding: '8px 16px', background: 'white', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer' }}>Login</button>
              <button onClick={() => setPage('signup')} style={{ padding: '8px 16px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Sign Up</button>
            </div>
          )}
        </div>
      </div>

      {page === 'home' && <HomePage setPage={setPage} />}
      {page === 'signup' && <SignupPage setPage={setPage} login={login} />}
      {page === 'login' && <LoginPage setPage={setPage} login={login} />}
      {page === 'category-select' && <CategorySelectPage setPage={setPage} />}
      {page === 'customer' && <CustomerPage token={token} setPage={setPage} />}
      {page === 'owner' && <OwnerPage token={token} user={user} />}
    </div>
  );
}

// Home Page
function HomePage({ setPage }) {
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '64px 16px', textAlign: 'center' }}>
      <h2 style={{ fontSize: '48px', marginBottom: '16px' }}>Skip the Line</h2>
      <p style={{ fontSize: '20px', color: '#6b7280', marginBottom: '32px' }}>Join queues digitally with AI-powered wait time predictions</p>
      <button onClick={() => setPage('signup')} style={{ padding: '16px 32px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', cursor: 'pointer' }}>Get Started</button>
    </div>
  );
}

// Signup Page
function SignupPage({ setPage, login }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '', role: 'customer' });
  const [userId, setUserId] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');

  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.signup(formData);
      const data = await res.json();
      if (data.success) {
        setUserId(data.data.userId);
        setStep(2);
        alert(`OTP: ${data.data.otp}`);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Error signing up');
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.verifyOTP({ userId, otp });
      const data = await res.json();
      if (data.success) {
        login(data.data.user, data.token);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Verification failed');
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '64px auto', padding: '16px' }}>
      <div style={{ background: 'white', padding: '32px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h2 style={{ marginBottom: '24px', textAlign: 'center' }}>{step === 1 ? 'Sign Up' : 'Verify OTP'}</h2>
        {error && <div style={{ padding: '12px', background: '#fee2e2', color: '#dc2626', borderRadius: '4px', marginBottom: '16px' }}>{error}</div>}
        {step === 1 ? (
          <form onSubmit={handleSignup}>
            <input type="text" placeholder="Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required style={inputStyle} />
            <input type="email" placeholder="Email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} required style={inputStyle} />
            <input type="tel" placeholder="Phone (10 digits)" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} pattern="[0-9]{10}" required style={inputStyle} />
            <input type="password" placeholder="Password" value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})} minLength="6" required style={inputStyle} />
            <select value={formData.role} onChange={(e) => setFormData({...formData, role: e.target.value})} style={inputStyle}>
              <option value="customer">Customer</option>
              <option value="store_owner">Store Owner</option>
            </select>
            <button type="submit" style={buttonStyle}>Sign Up</button>
          </form>
        ) : (
          <form onSubmit={handleVerify}>
            <input type="text" placeholder="Enter 6-digit OTP" value={otp} onChange={(e) => setOtp(e.target.value)} maxLength="6" required style={{...inputStyle, textAlign: 'center', fontSize: '24px'}} />
            <button type="submit" style={buttonStyle}>Verify</button>
          </form>
        )}
        <p style={{ marginTop: '16px', textAlign: 'center' }}>Have an account? <button onClick={() => setPage('login')} style={{ color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer' }}>Login</button></p>
      </div>
    </div>
  );
}

// Login Page
function LoginPage({ setPage, login }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await api.login({ email, password });
      const data = await res.json();
      if (data.success) {
        login(data.data.user, data.token);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Login failed');
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '64px auto', padding: '16px' }}>
      <div style={{ background: 'white', padding: '32px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h2 style={{ marginBottom: '24px', textAlign: 'center' }}>Login</h2>
        {error && <div style={{ padding: '12px', background: '#fee2e2', color: '#dc2626', borderRadius: '4px', marginBottom: '16px' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required style={inputStyle} />
          <button type="submit" style={buttonStyle}>Login</button>
        </form>
        <p style={{ marginTop: '16px', textAlign: 'center' }}>No account? <button onClick={() => setPage('signup')} style={{ color: '#4f46e5', background: 'none', border: 'none', cursor: 'pointer' }}>Sign Up</button></p>
      </div>
    </div>
  );
}

// Category Selection Page
function CategorySelectPage({ setPage }) {
  const categories = [
    { id: 'bank', name: 'Banks', icon: '🏦', color: '#3b82f6' },
    { id: 'hospital', name: 'Hospitals', icon: '🏥', color: '#ef4444' },
    { id: 'retail', name: 'Retail Stores', icon: '🏪', color: '#10b981' },
    { id: 'restaurant', name: 'Restaurants', icon: '🍽️', color: '#f59e0b' },
    { id: 'government', name: 'Government', icon: '🏛️', color: '#6366f1' },
    { id: '', name: 'All Stores', icon: '🌐', color: '#8b5cf6' }
  ];

  const handleCategorySelect = (categoryId) => {
    localStorage.setItem('selectedCategory', categoryId);
    setPage('customer');
  };

  return (
    <div style={{ maxWidth: '900px', margin: '64px auto', padding: '16px' }}>
      <h2 style={{ textAlign: 'center', marginBottom: '16px', fontSize: '32px' }}>What are you looking for?</h2>
      <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: '48px' }}>Select a category to browse stores</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '24px' }}>
        {categories.map(cat => (
          <div key={cat.id} onClick={() => handleCategorySelect(cat.id)} style={{ background: 'white', padding: '32px', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', transition: 'transform 0.2s', border: '2px solid transparent' }} onMouseOver={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.borderColor = cat.color; }} onMouseOut={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = 'transparent'; }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{cat.icon}</div>
            <h3 style={{ margin: '0', color: cat.color }}>{cat.name}</h3>
          </div>
        ))}
      </div>
    </div>
  );
}

// 🔥 Customer Dashboard with REAL-TIME UPDATES & WITHDRAW
function CustomerPage({ token, setPage }) {
  const [stores, setStores] = useState([]);
  const [myQueues, setMyQueues] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [showImageUpload, setShowImageUpload] = useState(false);
  const [selectedStore, setSelectedStore] = useState(null);
  const [imageResult, setImageResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [realtimeUpdate, setRealtimeUpdate] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [movementNotices, setMovementNotices] = useState({});
  const previousPositionsRef = useRef({});
  const fiveMinNotifiedRef = useRef({});
  const [showJoinLater, setShowJoinLater] = useState(false);
  const [joinLaterStart, setJoinLaterStart] = useState('');
  const [joinLaterEnd, setJoinLaterEnd] = useState('');
  const [showJoinNow, setShowJoinNow] = useState(false);
  const [joinNowPriority, setJoinNowPriority] = useState('normal');
  const [joinLaterPriority, setJoinLaterPriority] = useState('normal');

  const category = localStorage.getItem('selectedCategory') || '';

  // 🔌 Initialize Socket.IO
  useEffect(() => {
    if (!socket) {
      socket = io(API_BASE);
      
      socket.on('connect', () => {
        console.log('🔌 Connected to real-time server');
      });

      socket.on('disconnect', () => {
        console.log('🔌 Disconnected from server');
      });
    }

    return () => {
      // Don't disconnect on unmount, only on logout
    };
  }, []);

  // ⏱ Live countdown tick
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // 📡 Listen for real-time updates for MY queues
  useEffect(() => {
    if (!socket || myQueues.length === 0) return;

    myQueues.forEach(queue => {
      socket.emit('joinQueue', queue._id);

      // Listen for wait time updates
      socket.on('waitTimeUpdate', (data) => {
        if (data.queueId === queue._id) {
          const prevPosition = previousPositionsRef.current[data.queueId];
          if (prevPosition && data.positionInQueue && data.positionInQueue < prevPosition) {
            const movedUp = prevPosition - data.positionInQueue;
            setMovementNotices((prev) => ({
              ...prev,
              [data.queueId]: `You moved up ${movedUp} spots`
            }));
            setTimeout(() => {
              setMovementNotices((prev) => {
                const next = { ...prev };
                delete next[data.queueId];
                return next;
              });
            }, 4000);
          }
          if (data.positionInQueue) {
            previousPositionsRef.current[data.queueId] = data.positionInQueue;
          }
          const remaining = data.estimatedWaitTime;
          if (remaining <= 5 && !fiveMinNotifiedRef.current[data.queueId]) {
            fiveMinNotifiedRef.current[data.queueId] = true;
            setRealtimeUpdate('⏰ Your turn in 5 mins');
          } else if (data.delta < 0) {
            setRealtimeUpdate('⚡ Queue is moving faster');
          } else if (data.delta > 0) {
            setRealtimeUpdate('⚠️ Delay detected');
          } else {
            setRealtimeUpdate(`⚡ Your wait time updated: ${data.estimatedWaitTime} mins (Position: ${data.positionInQueue})`);
          }
          loadData(); // Reload to get fresh data
          setTimeout(() => setRealtimeUpdate(null), 5000);
        }
      });

      // Listen for status updates
      socket.on('statusUpdate', (data) => {
        if (data.queueId === queue._id) {
          setRealtimeUpdate(`⚡ Your status changed: ${data.status}`);
          loadData();
          setTimeout(() => setRealtimeUpdate(null), 5000);
        }
      });

      socket.on('callNext', (data) => {
        if (data.queueId === queue._id) {
          setRealtimeUpdate(`📣 You are next! Please proceed to the counter.`);
          setTimeout(() => setRealtimeUpdate(null), 5000);
        }
      });
    });

    // Join store rooms to see queue size changes
    const storeIds = [...new Set(myQueues.map(q => q.store._id))];
    storeIds.forEach(storeId => {
      socket.emit('joinStore', storeId);
    });

    socket.on('customerWithdrew', (data) => {
      setRealtimeUpdate(`⚡ Someone left the queue at ${data.tokenNumber}`);
      loadData();
      setTimeout(() => setRealtimeUpdate(null), 5000);
    });

  }, [myQueues.length]);

  useEffect(() => {
    loadData();
  }, [category]);

  const loadData = async () => {
    try {
      const [storesRes, queuesRes] = await Promise.all([api.getStores(category), api.getMyQueues(token)]);
      const storesData = await storesRes.json();
      const queuesData = await queuesRes.json();
      if (storesData.success) setStores(storesData.data.stores);
      if (queuesData.success) {
        setMyQueues(queuesData.data.queues);
        const nextPositions = { ...previousPositionsRef.current };
        queuesData.data.queues.forEach((q) => {
          if (q.positionInQueue) {
            nextPositions[q._id] = q.positionInQueue;
          }
        });
        previousPositionsRef.current = nextPositions;
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const joinQueue = async (storeId, priority) => {
    if (!token) {
      alert('Please login to join the queue.');
      setPage('login');
      return;
    }
    try {
      const res = await api.joinQueue({ storeId, priority }, token);
      const data = await res.json();
      if (res.status === 401) {
        alert('Session expired. Please login again.');
        setPage('login');
        return;
      }
      if (data.success) {
        alert(`✅ Joined! Token: ${data.data.queue.tokenNumber}`);
        loadData();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Failed to join');
    }
  };

  const getStorePriorities = (store) => {
    if (store?.priorityRules && store.priorityRules.length > 0) return store.priorityRules;
    return ['normal', 'high', 'urgent'];
  };

  const openJoinNow = (store) => {
    setSelectedStore(store);
    const priorities = getStorePriorities(store);
    setJoinNowPriority(priorities[0] || 'normal');
    setShowJoinNow(true);
  };

  const openJoinLater = (store) => {
    setSelectedStore(store);
    setJoinLaterStart('');
    setJoinLaterEnd('');
    const priorities = getStorePriorities(store);
    setJoinLaterPriority(priorities[0] || 'normal');
    setShowJoinLater(true);
  };

  const scheduleJoinLater = async (e) => {
    e.preventDefault();
    if (!selectedStore || !joinLaterStart || !joinLaterEnd) return;
    if (!token) {
      alert('Please login to schedule a queue.');
      setPage('login');
      return;
    }


    const today = new Date();
    const [startH, startM] = joinLaterStart.split(':').map(Number);
    const [endH, endM] = joinLaterEnd.split(':').map(Number);
    const start = new Date(today);
    start.setHours(startH, startM, 0, 0);
    const end = new Date(today);
    end.setHours(endH, endM, 0, 0);

    if (end <= start) {
      alert('Please select a valid time window.');
      return;
    }

    if (end <= new Date()) {
      alert('Please choose a future time window.');
      return;
    }

    const hours = getStoreHoursForToday(selectedStore);
    const [openH, openM] = hours.open.split(':').map(Number);
    const [closeH, closeM] = hours.close.split(':').map(Number);
    const openTime = new Date(today);
    openTime.setHours(openH, openM, 0, 0);
    const closeTime = new Date(today);
    closeTime.setHours(closeH, closeM, 0, 0);

    if (start < openTime || end > closeTime) {
      alert(`Please choose a window within store hours (${hours.open}-${hours.close}).`);
      return;
    }

    try {
      const res = await api.joinQueueLater(
        {
          storeId: selectedStore._id,
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
          priority: joinLaterPriority
        },
        token
      );
      const data = await res.json();
      if (res.status === 401) {
        alert('Session expired. Please login again.');
        setPage('login');
        return;
      }
      if (data.success) {
        alert(`✅ Scheduled! Token: ${data.data.queue.tokenNumber}`);
        setShowJoinLater(false);
        loadData();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Failed to schedule');
    }
  };

  const submitJoinNow = async (e) => {
    e.preventDefault();
    if (!selectedStore) return;
    await joinQueue(selectedStore._id, joinNowPriority);
    setShowJoinNow(false);
  };

  const formatTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStoreHoursForToday = (store) => {
    const dayKey = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const hours = store?.operatingHours?.[dayKey];
    if (hours && hours.open && hours.close) {
      return { open: hours.open, close: hours.close };
    }
    return { open: '08:00', close: '20:00' };
  };

  // 🚪 NEW: Withdraw from queue
  const withdrawFromQueue = async (queueId, tokenNumber) => {
    const confirmed = window.confirm(`Are you sure you want to withdraw from queue (${tokenNumber})? This will update wait times for others.`);
    if (!confirmed) return;

    try {
      const res = await api.withdrawQueue(queueId, token);
      const data = await res.json();
      if (data.success) {
        alert('✅ ' + data.message);
        loadData();
      } else {
        alert('❌ ' + data.message);
      }
    } catch (err) {
      alert('Failed to withdraw');
    }
  };

  const viewForecast = async (storeId) => {
    try {
      const res = await api.getForecast(storeId);
      const data = await res.json();
      if (data.success) setForecast(data.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleImageUpload = (store) => {
    setSelectedStore(store);
    setShowImageUpload(true);
  };

  const processImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result;
      try {
        const res = await api.countPeople(base64, selectedStore.avgServiceTime);
        const data = await res.json();
        if (data.success) {
          setImageResult(data.data);
        } else {
          alert('Failed to analyze image');
        }
      } catch (err) {
        alert('Image analysis service unavailable. Join queue normally.');
      }
    };
    reader.readAsDataURL(file);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: '64px' }}>Loading...</div>;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 16px' }}>
      {/* Real-time Update Notification */}
      {realtimeUpdate && (
        <div style={{ position: 'fixed', top: '80px', right: '16px', background: '#10b981', color: 'white', padding: '16px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000, maxWidth: '400px', animation: 'slideIn 0.3s ease' }}>
          {realtimeUpdate}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h2>Browse Stores {category && `- ${category}`}</h2>
        <button onClick={() => setPage('category-select')} style={{ padding: '8px 16px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Change Category</button>
      </div>

      {/* My Active Queues with WITHDRAW BUTTON */}
      {myQueues.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <h3>My Active Queues 🔔</h3>
          <div style={{ display: 'grid', gap: '16px' }}>
            {myQueues.map(q => {
              const updatedAt = q.waitTimeUpdatedAt ? new Date(q.waitTimeUpdatedAt).getTime() : Date.now();
              const elapsedMinutes = Math.max(0, Math.floor((now - updatedAt) / 60000));
              const remainingWait = q.status === 'waiting'
                ? Math.max(0, (q.estimatedWaitTime || 0) - elapsedMinutes)
                : q.estimatedWaitTime;
              const breakdown = (q.status === 'waiting' && q.peopleAhead != null && q.store?.avgServiceTime != null)
                ? `${q.peopleAhead} × ${q.store.avgServiceTime} = ${q.peopleAhead * q.store.avgServiceTime}`
                : null;
              const scheduledWindow = q.status === 'scheduled'
                ? `${formatTime(q.scheduledStart)} - ${formatTime(q.scheduledEnd)}`
                : null;

              return (
                <div key={q._id} style={{ background: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #4f46e5' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1 }}>
                      <strong>{q.store.name}</strong>
                      <p style={{ margin: '4px 0', fontSize: '24px', fontWeight: 'bold', color: '#4f46e5' }}>Token: {q.tokenNumber}</p>
                      {q.status === 'scheduled' ? (
                        <p style={{ color: '#6b7280', margin: '4px 0' }}>⏰ Scheduled: {scheduledWindow}</p>
                      ) : (
                        <>
                          <p style={{ color: '#6b7280', margin: '4px 0' }}>⏱️ Wait: ~{remainingWait} mins</p>
                        </>
                      )}
                      <p style={{ color: '#10b981', fontSize: '12px', margin: '4px 0' }}>🔔 Real-time updates enabled</p>
                      {movementNotices[q._id] && (
                        <div className="queue-move">{movementNotices[q._id]}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                      <span style={{ padding: '4px 12px', background: q.status === 'waiting' ? '#fef3c7' : q.status === 'scheduled' ? '#e0f2fe' : '#d1fae5', borderRadius: '12px', fontSize: '14px' }}>{q.status}</span>
                      {(q.status === 'waiting' || q.status === 'scheduled') && (
                        <button onClick={() => withdrawFromQueue(q._id, q.tokenNumber)} style={{ padding: '8px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
                          🚪 Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h3>Available Stores</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
        {stores.map(store => (
          <div key={store._id} style={{ background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ background: '#4f46e5', color: 'white', padding: '16px' }}>
              <h4 style={{ margin: 0 }}>{store.name}</h4>
              <p style={{ margin: '4px 0 0 0' }}>{store.category}</p>
            </div>
            <div style={{ padding: '16px' }}>
              <p>📍 {store.address.city}</p>
              <p>👥 Queue: {store.currentQueueSize}/{store.maxQueueSize}</p>
              <p>⏱️ Avg: {store.avgServiceTime} mins</p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexDirection: 'column' }}>
                <button onClick={() => openJoinNow(store)} style={{ padding: '8px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Join Queue</button>
                <button onClick={() => openJoinLater(store)} style={{ padding: '8px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Join Later</button>
                <button onClick={() => handleImageUpload(store)} style={{ padding: '8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>📸 Upload Queue Photo</button>
                <button onClick={() => viewForecast(store._id)} style={{ padding: '8px', background: '#f3f4f6', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>AI Forecast</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Image Upload Modal */}
      {showImageUpload && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => { setShowImageUpload(false); setImageResult(null); }}>
          <div style={{ background: 'white', padding: '32px', borderRadius: '8px', maxWidth: '500px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3>Upload Queue Photo</h3>
            <p style={{ color: '#6b7280', marginBottom: '16px' }}>Take a photo of the queue and our AI will estimate wait time</p>
            
            {!imageResult ? (
              <div>
                <input type="file" accept="image/*" capture="environment" onChange={processImage} style={{ marginBottom: '16px', width: '100%' }} />
                <p style={{ fontSize: '14px', color: '#6b7280' }}>📸 Tip: Make sure people in queue are clearly visible</p>
              </div>
            ) : (
              <div>
                <div style={{ background: '#4f46e5', color: 'white', padding: '24px', borderRadius: '8px', textAlign: 'center', marginBottom: '16px' }}>
                  <p style={{ margin: 0 }}>Estimated Wait Time</p>
                  <p style={{ fontSize: '48px', fontWeight: 'bold', margin: '8px 0' }}>{imageResult.estimatedWaitTime}</p>
                  <p style={{ margin: 0 }}>minutes</p>
                </div>
                <div style={{ background: '#f3f4f6', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <p>👥 People Detected: <strong>{imageResult.peopleCount}</strong></p>
                  <p>⏱️ Confidence: <strong>{imageResult.confidence}</strong></p>
                </div>
                <button onClick={() => joinQueue(selectedStore._id, getStorePriorities(selectedStore)[0])} style={{ width: '100%', padding: '12px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Join Queue</button>
              </div>
            )}
            
            <button onClick={() => { setShowImageUpload(false); setImageResult(null); }} style={{ width: '100%', marginTop: '8px', padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* Join Now Modal */}
      {showJoinNow && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setShowJoinNow(false)}>
          <div style={{ background: 'white', padding: '32px', borderRadius: '8px', maxWidth: '500px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3>Join Queue</h3>
            <p style={{ color: '#6b7280', marginBottom: '16px' }}>Choose priority if needed.</p>
            <form onSubmit={submitJoinNow}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#6b7280' }}>Priority</label>
              <select value={joinNowPriority} onChange={(e) => setJoinNowPriority(e.target.value)} style={inputStyle}>
                {getStorePriorities(selectedStore).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button type="submit" style={{ ...buttonStyle, marginTop: '8px' }}>Join</button>
            </form>
            <button onClick={() => setShowJoinNow(false)} style={{ width: '100%', marginTop: '8px', padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* Join Later Modal */}
      {showJoinLater && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setShowJoinLater(false)}>
          <div style={{ background: 'white', padding: '32px', borderRadius: '8px', maxWidth: '500px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3>Schedule a Queue Slot</h3>
            <p style={{ color: '#6b7280', marginBottom: '16px' }}>
              Select a time window for today. We’ll add you when the window starts.
            </p>
            {selectedStore && (
              <p style={{ color: '#6b7280', marginBottom: '16px', fontSize: '13px' }}>
                Store hours: {getStoreHoursForToday(selectedStore).open} - {getStoreHoursForToday(selectedStore).close}
              </p>
            )}
            <form onSubmit={scheduleJoinLater}>
              <label style={{ display: 'block', marginBottom: '8px', color: '#6b7280' }}>Priority</label>
              <select value={joinLaterPriority} onChange={(e) => setJoinLaterPriority(e.target.value)} style={inputStyle}>
                {getStorePriorities(selectedStore).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <label style={{ display: 'block', marginBottom: '8px', color: '#6b7280' }}>Start Time</label>
              <input type="time" value={joinLaterStart} onChange={(e) => setJoinLaterStart(e.target.value)} required style={inputStyle} />
              <label style={{ display: 'block', marginBottom: '8px', color: '#6b7280' }}>End Time</label>
              <input type="time" value={joinLaterEnd} onChange={(e) => setJoinLaterEnd(e.target.value)} required style={inputStyle} />
              <button type="submit" style={{ ...buttonStyle, marginTop: '8px' }}>Schedule</button>
            </form>
            <button onClick={() => setShowJoinLater(false)} style={{ width: '100%', marginTop: '8px', padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* Forecast Modal */}
      {forecast && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setForecast(null)}>
          <div style={{ background: 'white', padding: '32px', borderRadius: '8px', maxWidth: '500px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3>Explainable Live Queue System</h3>
            <div style={{ background: '#4f46e5', color: 'white', padding: '24px', borderRadius: '8px', textAlign: 'center', marginBottom: '16px' }}>
              <p style={{ margin: 0 }}>Estimated Wait Time</p>
              <p style={{ fontSize: '48px', fontWeight: 'bold', margin: '8px 0' }}>{forecast.estimatedWaitTime}</p>
              <p style={{ margin: 0 }}>minutes</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div style={{ background: '#f3f4f6', padding: '16px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 8px 0', color: '#6b7280' }}>ARIMA Forecast</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{forecast.arimaForecast} min</p>
              </div>
              <div style={{ background: '#f3f4f6', padding: '16px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 8px 0', color: '#6b7280' }}>Queue Size</p>
                <p style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>{forecast.currentQueueSize}</p>
              </div>
            </div>
            {forecast.confidenceInterval && (
              <div style={{ background: '#f3f4f6', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ fontWeight: 'bold', marginBottom: '8px' }}>Confidence Interval</p>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Lower: {forecast.confidenceInterval.lower} min</span>
                  <span>Upper: {forecast.confidenceInterval.upper} min</span>
                </div>
              </div>
            )}
            {forecast.confidenceLevel && (
              <div style={{ background: '#ecfeff', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontWeight: 'bold' }}>Confidence: {forecast.confidenceLevel}</p>
                <p style={{ margin: '4px 0 0 0', color: '#6b7280', fontSize: '13px' }}>{forecast.confidenceRationale}</p>
              </div>
            )}
            {forecast.explanations && forecast.explanations.length > 0 && (
              <div style={{ background: '#fef9c3', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontWeight: 'bold' }}>Why wait time changed?</p>
                <ul style={{ margin: '8px 0 0 16px', color: '#6b7280', fontSize: '13px' }}>
                  {forecast.explanations.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {forecast.recommendations && forecast.recommendations.length > 0 && (
              <div style={{ background: '#ecfccb', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                <p style={{ margin: 0, fontWeight: 'bold' }}>Smart Queue Recommendation</p>
                <ul style={{ margin: '8px 0 0 16px', color: '#6b7280', fontSize: '13px' }}>
                  {forecast.recommendations.map((rec, idx) => (
                    <li key={idx}>
                      <strong>{rec.title}</strong>
                      {rec.rationale ? ` — ${rec.rationale}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p style={{ fontSize: '14px', color: '#6b7280', background: '#ede9fe', padding: '12px', borderRadius: '4px' }}>ℹ️ Trained on 90 days of historical data using ARIMA machine learning</p>
            <button onClick={() => setForecast(null)} style={{ width: '100%', marginTop: '16px', padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 🏪 Store Owner Dashboard with REAL-TIME UPDATES
function OwnerPage({ token, user }) {
  const [view, setView] = useState('stores');
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState(null);
  const [queue, setQueue] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [realtimeUpdate, setRealtimeUpdate] = useState(null);
  const [slaToday, setSlaToday] = useState(null);
  const [slaWeek, setSlaWeek] = useState(null);
  const [noShowEnabled, setNoShowEnabled] = useState(false);
  const [noShowPreview, setNoShowPreview] = useState(null);
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [modelInfo, setModelInfo] = useState(null);
  const [retrainStatus, setRetrainStatus] = useState('');
  const [modelPerf, setModelPerf] = useState(null);
  const [predictionSeries, setPredictionSeries] = useState([]);
  const [adminStores, setAdminStores] = useState([]);
  const [adminSelectedStore, setAdminSelectedStore] = useState('');
  const [adminLiveQueues, setAdminLiveQueues] = useState([]);
  const [adminAvgServiceTime, setAdminAvgServiceTime] = useState('');
  const [adminCounters, setAdminCounters] = useState('');
  const [adminActiveCounters, setAdminActiveCounters] = useState('');
  const [now, setNow] = useState(Date.now());

  // 🔌 Initialize Socket.IO for store owner
  useEffect(() => {
    if (!socket) {
      socket = io(API_BASE);
      
      socket.on('connect', () => {
        console.log('🔌 Store Owner connected to real-time server');
      });
    }
  }, []);

  // 📡 Listen for real-time updates for selected store
  useEffect(() => {
    if (!socket || !selectedStore) return;

    socket.emit('joinStore', selectedStore._id);

    const handleCustomerJoined = (data) => {
      if (data.storeId === selectedStore._id) {
        setRealtimeUpdate(`✅ New customer: ${data.newCustomer.tokenNumber}`);
        loadQueue(selectedStore._id);
        refreshInsights(selectedStore._id);
        setTimeout(() => setRealtimeUpdate(null), 5000);
      }
    };

    const handleCustomerWithdrew = (data) => {
      if (data.storeId === selectedStore._id) {
        setRealtimeUpdate(`🚪 Customer withdrew: ${data.tokenNumber}`);
        loadQueue(selectedStore._id);
        refreshInsights(selectedStore._id);
        setTimeout(() => setRealtimeUpdate(null), 5000);
      }
    };

    const handleQueueUpdate = (data) => {
      if (data.storeId === selectedStore._id) {
        setRealtimeUpdate(`🔄 Queue updated: ${data.currentQueueSize} people waiting`);
        setTimeout(() => setRealtimeUpdate(null), 5000);
      }
    };

    const handleQueueStatusUpdate = () => {
      loadQueue(selectedStore._id);
      refreshInsights(selectedStore._id);
    };

    socket.on('customerJoined', handleCustomerJoined);
    socket.on('customerWithdrew', handleCustomerWithdrew);
    socket.on('queueUpdate', handleQueueUpdate);
    socket.on('queueStatusUpdate', handleQueueStatusUpdate);

    return () => {
      socket.off('customerJoined', handleCustomerJoined);
      socket.off('customerWithdrew', handleCustomerWithdrew);
      socket.off('queueUpdate', handleQueueUpdate);
      socket.off('queueStatusUpdate', handleQueueStatusUpdate);
    };

  }, [selectedStore, socket, token]);

  // ⏱ Live timer tick for per-customer countdowns
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const refreshInsights = async (storeId) => {
    if (!storeId) return;
    try {
      const [todayRes, weekRes] = await Promise.all([
        api.getSLAStats(storeId, 'today', token),
        api.getSLAStats(storeId, '7d', token)
      ]);
      const todayData = await todayRes.json();
      const weekData = await weekRes.json();
      if (todayData.success) setSlaToday(todayData.data);
      if (weekData.success) setSlaWeek(weekData.data);

      const analyticsRes = await api.getQueueAnalytics(storeId, 7, token);
      const analyticsData = await analyticsRes.json();
      if (analyticsData.success) setAnalytics(analyticsData.data);

      const perfRes = await api.getModelPerformance(storeId, 7, token);
      const perfData = await perfRes.json();
      if (perfData.success) setModelPerf(perfData.data);

      const seriesRes = await api.getPredictionSeries(storeId, 30, token);
      const seriesData = await seriesRes.json();
      if (seriesData.success) setPredictionSeries(seriesData.data.series || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (!selectedStore) return;
    refreshInsights(selectedStore._id);
  }, [selectedStore, token]);

  useEffect(() => {
    loadStores();
  }, []);



  useEffect(() => {
    const loadNoShowStatus = async () => {
      if (!user || user.role !== 'admin') return;
      try {
        const res = await api.getNoShowStatus(token);
        const data = await res.json();
        if (data.success) {
          setNoShowEnabled(data.data.enabled);
        }
        const infoRes = await api.getModelInfo(token);
        const infoData = await infoRes.json();
        if (infoData.success) {
          setModelInfo(infoData.data);
        }
        const storesRes = await api.getAdminStores(token);
        const storesData = await storesRes.json();
        if (storesData.success) {
          setAdminStores(storesData.data.stores);
        }
      } catch (err) {
        console.error(err);
      }
    };
    loadNoShowStatus();
  }, [token, user]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    const id = setInterval(() => {
      loadAdminLiveQueues(adminSelectedStore || '');
    }, 4000);
    return () => clearInterval(id);
  }, [user, adminSelectedStore, token]);

  const loadStores = async () => {
    try {
      const res = await api.getMyStores(token);
      const data = await res.json();
      if (data.success) setStores(data.data.stores);
    } catch (err) {
      console.error(err);
    }
  };

  const loadQueue = async (storeId) => {
    try {
      const res = await api.getStoreQueue(storeId, token);
      const data = await res.json();
      if (data.success) setQueue(data.data.queues);
    } catch (err) {
      console.error(err);
    }
  };

  const selectStore = (store) => {
    setSelectedStore(store);
    setView('queue');
    loadQueue(store._id);
  };

  const updateStatus = async (queueId, status) => {
    try {
      await api.updateStatus(queueId, status, token);
      loadQueue(selectedStore._id);
    } catch (err) {
      alert('Failed to update');
    }
  };

  const callNext = async () => {
    if (!selectedStore) return;
    try {
      const res = await api.callNext(selectedStore._id, token);
      const data = await res.json();
      if (data.success) {
        loadQueue(selectedStore._id);
      } else {
        alert(data.message || 'Failed to call next');
      }
    } catch (err) {
      alert('Failed to call next');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get('name'),
      category: fd.get('category'),
      description: fd.get('description'),
      address: { city: fd.get('city'), state: fd.get('state'), pincode: fd.get('pincode') },
      phone: fd.get('phone'),
      email: fd.get('email'),
      avgServiceTime: parseInt(fd.get('avgServiceTime')),
      maxQueueSize: parseInt(fd.get('maxQueueSize')),
      services: fd.get('services').split(',').map(s => s.trim()).filter(Boolean),
      autoThrottleEnabled: fd.get('autoThrottleEnabled') === 'on',
      autoThrottleLimit: parseInt(fd.get('autoThrottleLimit')) || 0,
      priorityRules: fd.get('priorityRules').split(',').map(s => s.trim()).filter(Boolean)
    };
    try {
      const res = await api.createStore(data, token);
      const result = await res.json();
      if (result.success) {
        alert('Store created!');
        setShowCreate(false);
        loadStores();
      } else {
        alert(result.message);
      }
    } catch (err) {
      alert('Failed to create');
    }
  };

  const refreshNoShowPreview = async () => {
    setNoShowLoading(true);
    try {
      const res = await api.previewNoShows(token);
      const data = await res.json();
      if (data.success) {
        setNoShowPreview(data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setNoShowLoading(false);
    }
  };

  const toggleNoShow = async () => {
    const next = !noShowEnabled;
    try {
      const res = await api.toggleNoShow(next, token);
      const data = await res.json();
      if (data.success) {
        setNoShowEnabled(data.data.enabled);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const runNoShowNow = async () => {
    try {
      await api.runNoShow(token);
      refreshNoShowPreview();
    } catch (err) {
      console.error(err);
    }
  };

  const retrainModels = async () => {
    setRetrainStatus('Starting retrain...');
    try {
      const res = await api.retrainModels(token);
      const data = await res.json();
      setRetrainStatus(data.success ? 'Retrain started' : 'Retrain failed');
    } catch (err) {
      setRetrainStatus('Retrain failed');
    }
  };

  const loadAdminLiveQueues = async (storeId) => {
    try {
      const res = await api.getAdminLiveQueues(storeId, token);
      const data = await res.json();
      if (data.success) {
        setAdminLiveQueues(data.data.queues);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const updateAdminStoreSettings = async () => {
    if (!adminSelectedStore) return;
    const payload = {};
    if (adminAvgServiceTime) payload.avgServiceTime = parseInt(adminAvgServiceTime, 10);
    if (adminCounters) payload.counters = parseInt(adminCounters, 10);
    if (adminActiveCounters) payload.activeCounters = parseInt(adminActiveCounters, 10);
    try {
      await api.updateStoreAdmin(adminSelectedStore, payload, token);
    } catch (err) {
      console.error(err);
    }
  };

  const exportAdminCsv = async () => {
    try {
      const res = await api.exportQueuesCsv(adminSelectedStore || '', token);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'queues.csv';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  const groupedQueues = { All: queue };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px 16px' }}>
      {/* Real-time Update Notification */}
      {realtimeUpdate && (
        <div style={{ position: 'fixed', top: '80px', right: '16px', background: '#10b981', color: 'white', padding: '16px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', zIndex: 1000, maxWidth: '400px' }}>
          {realtimeUpdate}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h2>Store Owner Dashboard 🔔</h2>
        {view === 'stores' && (
          <button onClick={() => setShowCreate(true)} style={{ padding: '8px 16px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>+ Create Store</button>
        )}
        {view === 'queue' && (
          <button onClick={() => setView('stores')} style={{ padding: '8px 16px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>← Back</button>
        )}
      </div>

      {user && user.role === 'admin' && (
        <div style={{ background: 'white', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
          <h3 style={{ marginTop: 0 }}>Admin Controls</h3>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={noShowEnabled} onChange={toggleNoShow} />
              Enable auto no-show
            </label>
            <button onClick={refreshNoShowPreview} style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '4px', cursor: 'pointer' }}>
              {noShowLoading ? 'Refreshing...' : 'Preview'}
            </button>
            <button onClick={runNoShowNow} style={{ padding: '8px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Run Now
            </button>
          </div>
          {noShowPreview && (
            <div style={{ marginTop: '16px', background: '#f9fafb', padding: '12px', borderRadius: '6px' }}>
              <p style={{ margin: 0 }}>
                Candidates: <strong>{noShowPreview.count}</strong> (threshold: {noShowPreview.minutes} min)
              </p>
            </div>
          )}

          <div style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={retrainModels} style={{ padding: '8px 16px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              Retrain ARIMA Models
            </button>
            {retrainStatus && <span style={{ color: '#6b7280' }}>{retrainStatus}</span>}
          </div>
          {modelInfo && (
            <div style={{ marginTop: '12px', background: '#f9fafb', padding: '12px', borderRadius: '6px', fontSize: '13px', color: '#6b7280' }}>
              Model info available (metadata).
            </div>
          )}

          <div style={{ marginTop: '16px', background: '#f9fafb', padding: '12px', borderRadius: '6px' }}>
            <h4 style={{ marginTop: 0 }}>Admin Dashboard</h4>
            <label style={{ display: 'block', marginBottom: '6px', color: '#6b7280' }}>Select Store</label>
            <select value={adminSelectedStore} onChange={(e) => { setAdminSelectedStore(e.target.value); loadAdminLiveQueues(e.target.value); }} style={{ ...inputStyle, maxWidth: '400px' }}>
              <option value="">All Stores</option>
              {adminStores.map(s => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '12px' }}>
              <input value={adminAvgServiceTime} onChange={(e) => setAdminAvgServiceTime(e.target.value)} placeholder="Set Avg Service Time" style={inputStyle} />
              <input value={adminCounters} onChange={(e) => setAdminCounters(e.target.value)} placeholder="Set Counters" style={inputStyle} />
              <input value={adminActiveCounters} onChange={(e) => setAdminActiveCounters(e.target.value)} placeholder="Set Active Counters" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
              <button onClick={updateAdminStoreSettings} style={{ padding: '8px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                Update Store
              </button>
              <button onClick={() => loadAdminLiveQueues(adminSelectedStore)} style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '4px', cursor: 'pointer' }}>
                Refresh Live Queues
              </button>
              <button onClick={exportAdminCsv} style={{ padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                Export CSV
              </button>
            </div>

            <div style={{ marginTop: '12px' }}>
              <p style={{ margin: '0 0 8px 0', color: '#6b7280' }}>Live Queues</p>
              {adminLiveQueues.length === 0 ? (
                <p style={{ color: '#6b7280' }}>No live queues</p>
              ) : (
                <div style={{ display: 'grid', gap: '8px' }}>
                  {adminLiveQueues.map(q => (
                    <div key={q._id} style={{ padding: '8px', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                      <strong>{q.store?.name}</strong> — {q.tokenNumber} — {q.status}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {view === 'stores' && (
        <div>
          {stores.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px' }}>
              <p>No stores yet</p>
              <button onClick={() => setShowCreate(true)} style={{ marginTop: '16px', padding: '12px 24px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Create First Store</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {stores.map(store => (
                <div key={store._id} style={{ background: 'white', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer' }} onClick={() => selectStore(store)}>
                  <div style={{ background: '#4f46e5', color: 'white', padding: '16px' }}>
                    <h4 style={{ margin: 0 }}>{store.name}</h4>
                    <p style={{ margin: '4px 0 0 0' }}>{store.category}</p>
                  </div>
                  <div style={{ padding: '16px' }}>
                    <p>Current Queue: <strong>{store.currentQueueSize}</strong></p>
                    <p>Max Capacity: <strong>{store.maxQueueSize}</strong></p>
                    <p>Status: <span style={{ color: store.isActive ? '#10b981' : '#ef4444' }}>{store.isActive ? 'Active' : 'Inactive'}</span></p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'queue' && selectedStore && (
        <div>
          <div style={{ background: 'white', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
            <h3>{selectedStore.name} 🔔 Real-time</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', marginTop: '16px' }}>
              <div>
                <p style={{ color: '#6b7280' }}>Current Queue</p>
                <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '4px 0' }}>{selectedStore.currentQueueSize}</p>
              </div>
              <div>
                <p style={{ color: '#6b7280' }}>Capacity</p>
                <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '4px 0' }}>{selectedStore.maxQueueSize}</p>
              </div>
              <div>
                <p style={{ color: '#6b7280' }}>Avg Service</p>
                <p style={{ fontSize: '32px', fontWeight: 'bold', margin: '4px 0' }}>{selectedStore.avgServiceTime}m</p>
              </div>
            </div>
          </div>

          <div style={{ background: 'white', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
            <h4 style={{ marginTop: 0 }}>SLA Snapshot</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: 'linear-gradient(135deg, #eef2ff, #f8fafc)', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <p style={{ margin: '0 0 8px 0', color: '#6b7280' }}>Today</p>
                <p style={{ margin: '0 0 4px 0' }}>Avg Estimated: <strong>{slaToday ? slaToday.avgEstimated : 0} min</strong></p>
                <p style={{ margin: '0 0 4px 0' }}>Avg Actual: <strong>{slaToday ? slaToday.avgActual : 0} min</strong></p>
                <p style={{ margin: 0 }}>
                  Variance: <strong>{slaToday ? slaToday.variance : 0}</strong>
                  <span title="Variance measures how spread out actual wait times are from the estimate. Lower is more consistent." style={{ marginLeft: '6px', color: '#6b7280', cursor: 'help' }}>ⓘ</span>
                </p>
              </div>
              <div style={{ background: 'linear-gradient(135deg, #ecfeff, #f8fafc)', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                <p style={{ margin: '0 0 8px 0', color: '#6b7280' }}>Last 7 Days</p>
                <p style={{ margin: '0 0 4px 0' }}>Avg Estimated: <strong>{slaWeek ? slaWeek.avgEstimated : 0} min</strong></p>
                <p style={{ margin: '0 0 4px 0' }}>Avg Actual: <strong>{slaWeek ? slaWeek.avgActual : 0} min</strong></p>
                <p style={{ margin: 0 }}>
                  Variance: <strong>{slaWeek ? slaWeek.variance : 0}</strong>
                  <span title="Variance measures how spread out actual wait times are from the estimate. Lower is more consistent." style={{ marginLeft: '6px', color: '#6b7280', cursor: 'help' }}>ⓘ</span>
                </p>
              </div>
            </div>
          </div>

          <div style={{ background: 'white', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
            <h4 style={{ marginTop: 0 }}>Queue Analytics (Last 7 Days)</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
              <div style={{ background: '#f3f4f6', padding: '12px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 6px 0', color: '#6b7280' }}>Avg Wait</p>
                <strong>{analytics ? analytics.avgWait : 0} min</strong>
              </div>
              <div style={{ background: '#f3f4f6', padding: '12px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 6px 0', color: '#6b7280' }}>Drop-off Rate</p>
                <strong>{analytics ? analytics.dropoffRate : 0}%</strong>
              </div>
              <div style={{ background: '#f3f4f6', padding: '12px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 6px 0', color: '#6b7280' }}>Peak Hours</p>
                <strong>{analytics && analytics.peakHours && analytics.peakHours.length > 0 ? analytics.peakHours.map(p => `${p.hour}:00`).join(', ') : 'N/A'}</strong>
              </div>
            </div>
          </div>

          <div style={{ background: 'white', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
            <h4 style={{ marginTop: 0 }}>Model Performance (Last 7 Days)</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
              <div style={{ background: '#f3f4f6', padding: '12px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 6px 0', color: '#6b7280' }}>MAE</p>
                <strong>{modelPerf ? modelPerf.mae : 0} min</strong>
              </div>
              <div style={{ background: '#f3f4f6', padding: '12px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 6px 0', color: '#6b7280' }}>RMSE</p>
                <strong>{modelPerf ? modelPerf.rmse : 0} min</strong>
              </div>
              <div style={{ background: '#f3f4f6', padding: '12px', borderRadius: '8px' }}>
                <p style={{ margin: '0 0 6px 0', color: '#6b7280' }}>MAPE</p>
                <strong>{modelPerf ? modelPerf.mape : 0}%</strong>
              </div>
            </div>
          </div>

          <div style={{ background: 'white', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
            <h4 style={{ marginTop: 0 }}>Prediction Graph (Predicted vs Actual)</h4>
            {predictionSeries.length === 0 ? (
              <p style={{ color: '#6b7280' }}>Not enough data yet.</p>
            ) : (
              <svg width="100%" height="180" viewBox="0 0 600 180">
                {(() => {
                  const maxY = Math.max(...predictionSeries.map(p => Math.max(p.predicted, p.actual)), 1);
                  const pointsPred = predictionSeries.map((p, i) => {
                    const x = (i / Math.max(1, predictionSeries.length - 1)) * 580 + 10;
                    const y = 170 - (p.predicted / maxY) * 150;
                    return `${x},${y}`;
                  }).join(' ');
                  const pointsAct = predictionSeries.map((p, i) => {
                    const x = (i / Math.max(1, predictionSeries.length - 1)) * 580 + 10;
                    const y = 170 - (p.actual / maxY) * 150;
                    return `${x},${y}`;
                  }).join(' ');
                  return (
                    <>
                      <polyline fill="none" stroke="#4f46e5" strokeWidth="2" points={pointsPred} />
                      <polyline fill="none" stroke="#10b981" strokeWidth="2" points={pointsAct} />
                    </>
                  );
                })()}
                <text x="10" y="15" fill="#6b7280" fontSize="10">Predicted (blue) vs Actual (green)</text>
              </svg>
            )}
          </div>

          <div style={{ background: 'white', padding: '16px', borderRadius: '8px', marginBottom: '16px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={callNext} style={{ padding: '10px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              📣 Call Next
            </button>
          </div>

          <div style={{ background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ background: '#4f46e5', color: 'white', padding: '16px' }}>
              <h4 style={{ margin: 0 }}>Queue List (Updates Automatically)</h4>
            </div>
            <div style={{ padding: '16px' }}>
              {queue.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#6b7280', padding: '32px' }}>No customers in queue</p>
              ) : (
                <div style={{ display: 'grid', gap: '16px' }}>
                  {Object.entries(groupedQueues).map(([group, items]) => (
                    <div key={group}>
                      {group !== 'All' && (
                        <h5 style={{ margin: '8px 0', color: '#6b7280' }}>{group}</h5>
                      )}
                      <div style={{ display: 'grid', gap: '16px' }}>
                        {(() => {
                          const hasInService = items.some(i => i.status === 'in-service');
                          const firstWaitingId = items.find(i => i.status === 'waiting')?._id;
                          return items.map(item => (
                          <div key={item._id} style={{ border: '1px solid #e5e7eb', padding: '16px', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                              <div>
                                <p style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 4px 0' }}>{item.tokenNumber}</p>
                                <p style={{ margin: '0 0 4px 0' }}>{item.customer.name}</p>
                                <p style={{ color: '#6b7280', margin: 0, fontSize: '14px' }}>{item.customer.phone}</p>
                                {item.status === 'waiting' && (
                                  (() => {
                                    const updatedAt = item.waitTimeUpdatedAt ? new Date(item.waitTimeUpdatedAt).getTime() : Date.now();
                                    const elapsedMinutes = Math.max(0, Math.floor((now - updatedAt) / 60000));
                                    const remaining = Math.max(0, (item.estimatedWaitTime || 0) - elapsedMinutes);
                                    return (
                                      <p style={{ margin: '6px 0 0 0', color: '#6b7280', fontSize: '13px' }}>
                                        ⏳ Remaining: ~{remaining} mins
                                      </p>
                                    );
                                  })()
                                )}
                                {item.status === 'in-service' && item.serviceStartTime && (
                                  <p style={{ margin: '6px 0 0 0', color: '#6b7280', fontSize: '13px' }}>
                                    ⏱ In service: {Math.max(0, Math.floor((now - new Date(item.serviceStartTime).getTime()) / 60000))} mins
                                  </p>
                                )}
                              </div>
                              <span style={{ padding: '4px 12px', height: 'fit-content', background: item.status === 'waiting' ? '#fef3c7' : item.status === 'in-service' ? '#d1fae5' : '#f3f4f6', borderRadius: '12px', fontSize: '14px' }}>{item.status}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {item.status === 'waiting' && item._id === firstWaitingId && !hasInService && (
                                <button onClick={() => updateStatus(item._id, 'in-service')} style={{ flex: 1, padding: '8px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Start Service</button>
                              )}
                              {item.status === 'in-service' && (
                                <button onClick={() => updateStatus(item._id, 'completed')} style={{ flex: 1, padding: '8px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Complete</button>
                              )}
                              {(item.status === 'waiting' || item.status === 'in-service') && (
                                <button onClick={() => updateStatus(item._id, 'cancelled')} style={{ flex: 1, padding: '8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                              )}
                            </div>
                          </div>
                        ));
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', overflow: 'auto' }} onClick={() => setShowCreate(false)}>
          <div style={{ background: 'white', padding: '32px', borderRadius: '8px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: '24px' }}>Create New Store</h3>
            <form onSubmit={handleCreate}>
              <input name="name" placeholder="Store Name" required style={inputStyle} />
              <select name="category" required style={inputStyle}>
                <option value="">Select Category</option>
                <option value="retail">Retail</option>
                <option value="bank">Bank</option>
                <option value="hospital">Hospital</option>
                <option value="restaurant">Restaurant</option>
                <option value="government">Government</option>
                <option value="other">Other</option>
              </select>
              <textarea name="description" placeholder="Description" style={{...inputStyle, minHeight: '80px'}} />
              <input name="city" placeholder="City" required style={inputStyle} />
              <input name="state" placeholder="State" required style={inputStyle} />
              <input name="pincode" placeholder="Pincode" required style={inputStyle} />
              <input name="phone" placeholder="Phone" required style={inputStyle} />
              <input name="email" type="email" placeholder="Email" required style={inputStyle} />
              <input name="avgServiceTime" type="number" placeholder="Avg Service Time (minutes)" required style={inputStyle} />
              <input name="maxQueueSize" type="number" placeholder="Max Queue Size" required style={inputStyle} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <input type="checkbox" name="autoThrottleEnabled" defaultChecked />
                Enable auto-throttle
              </label>
              <input name="autoThrottleLimit" type="number" placeholder="Throttle Limit (optional)" style={inputStyle} />
              <input name="priorityRules" placeholder="Priority Rules (comma separated)" style={inputStyle} />
              <input name="services" placeholder="Services (comma separated)" required style={inputStyle} />
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button type="submit" style={{ flex: 1, padding: '12px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Create Store</button>
                <button type="button" onClick={() => setShowCreate(false)} style={{ flex: 1, padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '12px',
  marginBottom: '12px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  fontSize: '16px',
  boxSizing: 'border-box'
};

const buttonStyle = {
  width: '100%',
  padding: '12px',
  background: '#4f46e5',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  fontSize: '16px',
  cursor: 'pointer'
};
