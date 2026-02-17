const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { testConnection } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const bloodRequestRoutes = require('./routes/bloodRequests');
const donationRoutes = require('./routes/donations');
const contactRoutes = require('./routes/contact');
const inventoryRoutes = require('./routes/inventory');
const matchingRoutes = require('./routes/matching');
const alertRoutes = require('./routes/alerts');

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;

app.disable('x-powered-by');

const getCorsOrigins = () => {
  if (!process.env.CORS_ORIGIN) {
    return true;
  }

  return process.env.CORS_ORIGIN
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
};

// Middleware
app.use(cors({
  origin: getCorsOrigins(),
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static files from the root directory
app.use(express.static(path.join(__dirname), {
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

app.locals.dbConnected = false;
app.locals.dbInitPromise = Promise.resolve(false);
app.locals.lastDbRetry = 0;
const DB_RETRY_INTERVAL_MS = Number.parseInt(process.env.DB_RETRY_INTERVAL_MS, 10) || 30000;

const initializeDatabase = async () => {
  const dbConnected = await testConnection();
  app.locals.dbConnected = dbConnected;

  if (!dbConnected) {
    console.warn('⚠️ Database is unavailable. API data endpoints will return 503 until DB is reachable.');
  }

  return dbConnected;
};

app.locals.dbInitPromise = initializeDatabase();

const requireDatabase = async (req, res, next) => {
  try {
    await app.locals.dbInitPromise;

    if (!app.locals.dbConnected) {
      const now = Date.now();
      if (now - app.locals.lastDbRetry >= DB_RETRY_INTERVAL_MS) {
        app.locals.lastDbRetry = now;
        app.locals.dbInitPromise = initializeDatabase();
        await app.locals.dbInitPromise;
      }
    }

    if (app.locals.dbConnected) {
      return next();
    }

    return res.status(503).json({
      success: false,
      message: 'Database is currently unavailable. Check DB_* environment variables and MySQL availability.'
    });
  } catch (error) {
    return next(error);
  }
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'BloodBank API is running',
    database: app.locals.dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// API documentation endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'BloodBank API Documentation',
    version: '1.0.0',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Register a new user',
        'POST /api/auth/login': 'User login',
        'GET /api/auth/profile/:id': 'Get user profile',
        'PUT /api/auth/profile/:id': 'Update user profile'
      },
      bloodRequests: {
        'POST /api/blood-requests/create': 'Create a new blood request',
        'GET /api/blood-requests/all': 'Get all blood requests',
        'GET /api/blood-requests/by-blood-group/:bloodGroup': 'Get requests by blood group',
        'GET /api/blood-requests/by-location': 'Get requests by location',
        'GET /api/blood-requests/urgent/all': 'Get urgent requests',
        'GET /api/blood-requests/:id': 'Get specific blood request',
        'PUT /api/blood-requests/:id/status': 'Update request status',
        'DELETE /api/blood-requests/:id': 'Delete blood request'
      },
      donations: {
        'POST /api/donations/schedule': 'Schedule a blood donation',
        'PUT /api/donations/:id/complete': 'Complete a donation',
        'GET /api/donations/all': 'Get all donations',
        'GET /api/donations/donor/:donorId': 'Get donations by donor',
        'GET /api/donations/by-blood-group/:bloodGroup': 'Get donations by blood group',
        'GET /api/donations/statistics': 'Get donation statistics',
        'PUT /api/donations/:id/cancel': 'Cancel a donation'
      },
      contact: {
        'POST /api/contact/submit': 'Submit contact message',
        'GET /api/contact/all': 'Get all messages',
        'GET /api/contact/unread': 'Get unread messages',
        'GET /api/contact/statistics/overview': 'Get contact statistics',
        'PUT /api/contact/:id/read': 'Mark message as read',
        'PUT /api/contact/:id/replied': 'Mark message as replied',
        'GET /api/contact/:id': 'Get specific message',
        'DELETE /api/contact/:id': 'Delete message'
      },
      inventory: {
        'GET /api/inventory/all': 'Get blood inventory',
        'GET /api/inventory/blood-group/:bloodGroup': 'Get inventory by blood group',
        'PUT /api/inventory/update': 'Update inventory',
        'POST /api/inventory/add': 'Add blood units',
        'POST /api/inventory/reserve': 'Reserve blood units',
        'POST /api/inventory/release': 'Release reserved units',
        'GET /api/inventory/low-stock': 'Get low stock alerts',
        'GET /api/inventory/statistics': 'Get inventory statistics',
        'POST /api/inventory/initialize': 'Initialize blood group'
      },
      matching: {
        'GET /api/matching/nearby-donors': 'Match eligible donors by location and blood group',
        'GET /api/matching/cache/stats': 'Get donor search cache statistics'
      },
      alerts: {
        'GET /api/alerts/stream': 'Open live emergency alert stream (SSE)',
        'GET /api/alerts/stats': 'Get active stream connections'
      }
    }
  });
});

// API Routes
app.use('/api/auth', requireDatabase, authRoutes);
app.use('/api/blood-requests', requireDatabase, bloodRequestRoutes);
app.use('/api/donations', requireDatabase, donationRoutes);
app.use('/api/contact', requireDatabase, contactRoutes);
app.use('/api/inventory', requireDatabase, inventoryRoutes);
app.use('/api/matching', requireDatabase, matchingRoutes);
app.use('/api/alerts', requireDatabase, alertRoutes);

// Serve the main HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'Register.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/donate', (req, res) => {
  res.sendFile(path.join(__dirname, 'donate.html'));
});

app.get('/help', (req, res) => {
  res.sendFile(path.join(__dirname, 'help.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  const databaseErrorCodes = new Set([
    'ECONNREFUSED',
    'PROTOCOL_CONNECTION_LOST',
    'ER_ACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR',
    'ER_NO_SUCH_TABLE'
  ]);

  if (err && databaseErrorCodes.has(err.code)) {
    app.locals.dbConnected = false;
    return res.status(503).json({
      success: false,
      message: 'Database connection error. Please try again later.'
    });
  }

  console.error(err.stack);
  return res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

// 404 handler for frontend routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server for local/dev runtime
const startServer = async () => {
  try {
    await app.locals.dbInitPromise;
    app.listen(PORT, () => {
      console.log(`🚀 BloodBank server is running on port ${PORT}`);
      console.log(`📱 Frontend: http://localhost:${PORT}`);
      console.log(`🔗 API: http://localhost:${PORT}/api`);
      console.log(`📚 API Docs: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;
