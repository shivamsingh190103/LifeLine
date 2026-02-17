const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
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
  port: parseIntEnv(process.env.DB_PORT, 3306),
  charset: 'utf8mb4'
};

async function setupDatabase() {
  console.log('🚀 Setting up BloodBank Database...\n');

  let connection;
  try {
    // Create connection without database
    connection = mysql.createConnection(dbConfig);
    
    // Read schema file
    const schemaPath = path.join(__dirname, 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📖 Reading database schema...');
    
    // Split schema into individual statements
    const statements = schema
      .split(';')
      .map(statement =>
        statement
          .split('\n')
          .filter(line => !line.trim().startsWith('--'))
          .join('\n')
          .trim()
      )
      .filter(Boolean);

    console.log('🗄️  Creating database and tables...');
    
    // Execute each statement separately
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          await connection.promise().query(statement);
          console.log(`   ✅ Executed statement ${i + 1}/${statements.length}`);
        } catch (error) {
          console.log(`   ⚠️  Statement ${i + 1} failed (this might be expected): ${error.message}`);
        }
      }
    }
    
    console.log('✅ Database setup completed successfully!');
    console.log('\n📋 Database Details:');
    console.log('   - Database Name: bloodbank_db');
    console.log(`   - Host: ${dbConfig.host}`);
    console.log(`   - User: ${dbConfig.user}`);
    console.log(`   - Port: ${dbConfig.port}`);
    
    console.log('\n🎉 Setup completed! You can now start the application:');
    console.log('   npm start');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Make sure MySQL is running');
    console.log('   2. Verify your MySQL credentials in .env (DB_HOST, DB_USER, DB_PASSWORD, DB_PORT)');
    console.log('   3. Ensure you have permission to create databases');
    console.log('   4. Try running the schema manually: mysql -u root -p < database/schema.sql');
  } finally {
    if (connection) {
      connection.end();
    }
  }
}

// Check if MySQL is running
async function checkMySQLConnection() {
  try {
    const connection = mysql.createConnection(dbConfig);
    await connection.promise().query('SELECT 1');
    connection.end();
    return true;
  } catch (error) {
    return false;
  }
}

// Main setup function
async function main() {
  console.log('🏥 BloodBank Full-Stack Application Setup\n');
  
  const isMySQLRunning = await checkMySQLConnection();
  
  if (!isMySQLRunning) {
    console.log('❌ Cannot connect to MySQL. Please ensure:');
    console.log('   1. MySQL server is running');
    console.log('   2. Credentials in .env are correct');
    console.log(`   3. MySQL is accessible on ${dbConfig.host}:${dbConfig.port}`);
    process.exit(1);
  }
  
  console.log('✅ MySQL connection successful');
  await setupDatabase();
}

// Run setup
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { setupDatabase, checkMySQLConnection };
