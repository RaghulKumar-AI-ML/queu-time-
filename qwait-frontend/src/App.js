import React, { useState, useEffect } from 'react';
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
  joinQueue: (storeId, token) => fetch(`${API_URL}/queues/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ storeId }) }),
  withdrawQueue: (queueId, token) => fetch(`${API_URL}/queues/${queueId}/withdraw`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }),
  getMyQueues: (token) => fetch(`${API_URL}/queues/my-queues`, { headers: { 'Authorization': `Bearer ${token}` } }),
  getStoreQueue: (storeId, token) => fetch(`${API_URL}/queues/store/${storeId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
  updateStatus: (queueId, status, token) => fetch(`${API_URL}/queues/${queueId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ status }) }),
  getForecast: (storeId) => fetch(`${API_URL}/forecast/wait-time`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId }) }),
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
      setPage(JSON.parse(savedUser).role === 'store_owner' ? 'owner' : 'category-select');
    }
  }, []);

  const login = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', authToken);
    setPage(userData.role === 'store_owner' ? 'owner' : 'category-select');
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
          <h1 style={{ margin: 0, fontSize: '24px', color: '#4f46e5', cursor: 'pointer' }} onClick={() => setPage(user ? (user.role === 'store_owner' ? 'owner' : 'category-select') : 'home')}>Q-Wait 🔌</h1>
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
      {page === 'owner' && <OwnerPage token={token} />}
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

  // 📡 Listen for real-time updates for MY queues
  useEffect(() => {
    if (!socket || myQueues.length === 0) return;

    myQueues.forEach(queue => {
      socket.emit('joinQueue', queue._id);

      // Listen for wait time updates
      socket.on('waitTimeUpdate', (data) => {
        if (data.queueId === queue._id) {
          setRealtimeUpdate(`⚡ Your wait time updated: ${data.estimatedWaitTime} mins (Position: ${data.positionInQueue})`);
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
      if (queuesData.success) setMyQueues(queuesData.data.queues);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const joinQueue = async (storeId) => {
    try {
      const res = await api.joinQueue(storeId, token);
      const data = await res.json();
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
            {myQueues.map(q => (
              <div key={q._id} style={{ background: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #4f46e5' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    <strong>{q.store.name}</strong>
                    <p style={{ margin: '4px 0', fontSize: '24px', fontWeight: 'bold', color: '#4f46e5' }}>Token: {q.tokenNumber}</p>
                    <p style={{ color: '#6b7280', margin: '4px 0' }}>⏱️ Wait: ~{q.estimatedWaitTime} mins</p>
                    <p style={{ color: '#10b981', fontSize: '12px', margin: '4px 0' }}>🔔 Real-time updates enabled</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                    <span style={{ padding: '4px 12px', background: q.status === 'waiting' ? '#fef3c7' : '#d1fae5', borderRadius: '12px', fontSize: '14px' }}>{q.status}</span>
                    {q.status === 'waiting' && (
                      <button onClick={() => withdrawFromQueue(q._id, q.tokenNumber)} style={{ padding: '8px 16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
                        🚪 Withdraw
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
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
                <button onClick={() => joinQueue(store._id)} style={{ padding: '8px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Join Queue</button>
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
                <button onClick={() => joinQueue(selectedStore._id)} style={{ width: '100%', padding: '12px', background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Join Queue</button>
              </div>
            )}
            
            <button onClick={() => { setShowImageUpload(false); setImageResult(null); }} style={{ width: '100%', marginTop: '8px', padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}

      {/* Forecast Modal */}
      {forecast && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setForecast(null)}>
          <div style={{ background: 'white', padding: '32px', borderRadius: '8px', maxWidth: '500px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <h3>AI Wait Time Forecast</h3>
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
            <p style={{ fontSize: '14px', color: '#6b7280', background: '#ede9fe', padding: '12px', borderRadius: '4px' }}>ℹ️ Trained on 90 days of historical data using ARIMA machine learning</p>
            <button onClick={() => setForecast(null)} style={{ width: '100%', marginTop: '16px', padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 🏪 Store Owner Dashboard with REAL-TIME UPDATES
function OwnerPage({ token }) {
  const [view, setView] = useState('stores');
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState(null);
  const [queue, setQueue] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [realtimeUpdate, setRealtimeUpdate] = useState(null);

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

    socket.on('customerJoined', (data) => {
      if (data.storeId === selectedStore._id) {
        setRealtimeUpdate(`✅ New customer: ${data.newCustomer.tokenNumber}`);
        loadQueue(selectedStore._id);
        setTimeout(() => setRealtimeUpdate(null), 5000);
      }
    });

    socket.on('customerWithdrew', (data) => {
      if (data.storeId === selectedStore._id) {
        setRealtimeUpdate(`🚪 Customer withdrew: ${data.tokenNumber}`);
        loadQueue(selectedStore._id);
        setTimeout(() => setRealtimeUpdate(null), 5000);
      }
    });

    socket.on('queueUpdate', (data) => {
      if (data.storeId === selectedStore._id) {
        setRealtimeUpdate(`🔄 Queue updated: ${data.currentQueueSize} people waiting`);
        setTimeout(() => setRealtimeUpdate(null), 5000);
      }
    });

  }, [selectedStore]);

  useEffect(() => {
    loadStores();
  }, []);

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
      services: fd.get('services').split(',')
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

          <div style={{ background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ background: '#4f46e5', color: 'white', padding: '16px' }}>
              <h4 style={{ margin: 0 }}>Queue List (Updates Automatically)</h4>
            </div>
            <div style={{ padding: '16px' }}>
              {queue.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#6b7280', padding: '32px' }}>No customers in queue</p>
              ) : (
                <div style={{ display: 'grid', gap: '16px' }}>
                  {queue.map(item => (
                    <div key={item._id} style={{ border: '1px solid #e5e7eb', padding: '16px', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <div>
                          <p style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 4px 0' }}>{item.tokenNumber}</p>
                          <p style={{ margin: '0 0 4px 0' }}>{item.customer.name}</p>
                          <p style={{ color: '#6b7280', margin: 0, fontSize: '14px' }}>{item.customer.phone}</p>
                        </div>
                        <span style={{ padding: '4px 12px', height: 'fit-content', background: item.status === 'waiting' ? '#fef3c7' : item.status === 'in-service' ? '#d1fae5' : '#f3f4f6', borderRadius: '12px', fontSize: '14px' }}>{item.status}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {item.status === 'waiting' && (
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