const { Pool } = require('pg');
require('dotenv').config();

const readEnv = key => {
  const value = process.env[key];
  return typeof value === 'string' ? value.trim() : value;
};

const parseIntEnv = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const envFlagEnabled = value => {
  if (value === undefined || value === null) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === 'require';
};

const toPgPlaceholders = sql => {
  let position = 0;
  return sql.replace(/\?/g, () => {
    position += 1;
    return `$${position}`;
  });
};

const getInsertId = rows => {
  if (!rows || rows.length === 0) {
    return null;
  }

  const row = rows[0];
  if (Object.prototype.hasOwnProperty.call(row, 'id')) {
    return row.id;
  }

  const firstValue = Object.values(row)[0];
  return firstValue ?? null;
};

const normalizeExecuteResult = result => {
  const command = (result.command || '').toUpperCase();

  if (command === 'SELECT' || command === 'SHOW' || command === 'WITH') {
    return [result.rows];
  }

  return [{
    affectedRows: result.rowCount,
    insertId: getInsertId(result.rows)
  }];
};

const buildDbConfig = () => {
  const databaseUrl = readEnv('DATABASE_URL');
  const useConnectionString = Boolean(databaseUrl);
  const shouldUseSsl =
    envFlagEnabled(readEnv('DATABASE_SSL')) ||
    (useConnectionString &&
      !databaseUrl.includes('localhost') &&
      !databaseUrl.includes('127.0.0.1'));

  if (useConnectionString) {
    return {
      connectionString: databaseUrl,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
      max: parseIntEnv(readEnv('DB_CONNECTION_LIMIT'), 10),
      connectionTimeoutMillis: parseIntEnv(readEnv('DB_CONNECT_TIMEOUT_MS'), 10000),
      idleTimeoutMillis: parseIntEnv(readEnv('DB_IDLE_TIMEOUT_MS'), 30000)
    };
  }

  return {
    host: readEnv('DB_HOST') || 'localhost',
    user: readEnv('DB_USER') || 'postgres',
    password: readEnv('DB_PASSWORD') || '',
    database: readEnv('DB_NAME') || 'bloodbank_db',
    port: parseIntEnv(readEnv('DB_PORT'), 5432),
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    max: parseIntEnv(readEnv('DB_CONNECTION_LIMIT'), 10),
    connectionTimeoutMillis: parseIntEnv(readEnv('DB_CONNECT_TIMEOUT_MS'), 10000),
    idleTimeoutMillis: parseIntEnv(readEnv('DB_IDLE_TIMEOUT_MS'), 30000)
  };
};

const dbConfig = buildDbConfig();
const rawPool = new Pool(dbConfig);
let lastConnectionStatus = false;

const executeWithClient = async (client, sql, params = []) => {
  const text = toPgPlaceholders(sql);
  const result = await client.query(text, params);
  return normalizeExecuteResult(result);
};

const pool = {
  execute: (sql, params = []) => executeWithClient(rawPool, sql, params),
  query: (sql, params = []) => executeWithClient(rawPool, sql, params),
  getConnection: async () => {
    const client = await rawPool.connect();

    return {
      execute: (sql, params = []) => executeWithClient(client, sql, params),
      query: (sql, params = []) => executeWithClient(client, sql, params),
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release()
    };
  }
};

// Test database connection
const testConnection = async () => {
  try {
    await rawPool.query('SELECT 1');
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
  pool,
  testConnection,
  dbConfig
};
