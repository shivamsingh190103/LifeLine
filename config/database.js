const mysql = require('mysql2');
require('dotenv').config();

const parseIntEnv = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bloodbank_db',
  port: parseIntEnv(process.env.DB_PORT, 3306),
  charset: 'utf8mb4'
};

// Create connection pool
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: parseIntEnv(process.env.DB_CONNECTION_LIMIT, 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: parseIntEnv(process.env.DB_CONNECT_TIMEOUT_MS, 10000)
});

// Create promise wrapper
const promisePool = pool.promise();
let lastConnectionStatus = false;

// Test database connection
const testConnection = async () => {
  try {
    await promisePool.query('SELECT 1');
    if (!lastConnectionStatus) {
      console.log('✅ Database connected successfully');
    }
    lastConnectionStatus = true;
    return true;
  } catch (error) {
    const message = error && error.message ? error.message : 'Unknown database error';
    if (lastConnectionStatus) {
      console.error('❌ Lost database connection:', message);
    } else {
      console.error('❌ Database connection failed:', message);
    }
    lastConnectionStatus = false;
    return false;
  }
};

module.exports = {
  pool: promisePool,
  testConnection,
  dbConfig
};
