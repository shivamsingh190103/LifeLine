const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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

const getDbConfig = () => {
  const useConnectionString = Boolean(process.env.DATABASE_URL);
  const shouldUseSsl =
    envFlagEnabled(process.env.DATABASE_SSL) ||
    (useConnectionString &&
      !process.env.DATABASE_URL.includes('localhost') &&
      !process.env.DATABASE_URL.includes('127.0.0.1'));

  if (useConnectionString) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bloodbank_db',
    port: parseIntEnv(process.env.DB_PORT, 5432),
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : false
  };
};

const dbConfig = getDbConfig();

async function setupDatabase() {
  console.log('🚀 Setting up BloodBank PostgreSQL Schema...\n');

  const client = new Client(dbConfig);
  try {
    await client.connect();

    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📖 Applying schema from database/schema.sql...');
    await client.query(schema);

    console.log('✅ Database setup completed successfully!');
    console.log('\n🎉 Setup completed! You can now start the application:');
    console.log('   npm start');
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Make sure your Supabase/PostgreSQL database is reachable');
    console.log('   2. Verify DATABASE_URL or DB_* credentials in .env');
    console.log('   3. Ensure the DB user has schema/table creation permissions');
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkPostgresConnection() {
  const client = new Client(dbConfig);
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch (error) {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  console.log('🏥 BloodBank Full-Stack Application Setup\n');

  const connected = await checkPostgresConnection();
  if (!connected) {
    console.log('❌ Cannot connect to PostgreSQL/Supabase. Please ensure:');
    console.log('   1. DATABASE_URL or DB_* credentials in .env are correct');
    console.log('   2. Your network allows outbound DB connection');
    console.log('   3. SSL settings are correct for your provider');
    process.exit(1);
  }

  console.log('✅ PostgreSQL connection successful');
  await setupDatabase();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { setupDatabase, checkPostgresConnection };
