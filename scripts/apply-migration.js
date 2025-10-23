#!/usr/bin/env node

/**
 * Migration Script: Apply Polymarket Schema to Supabase
 *
 * This script:
 * 1. Connects to Supabase PostgreSQL database
 * 2. Executes the migration SQL file
 * 3. Optionally loads test data
 * 4. Verifies schema creation
 *
 * Usage:
 *   node scripts/apply-migration.js [--with-seed]
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Configuration from environment
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:EwchTep6Zw97GLw@db.cqvjfonlpqycmaonacvz.supabase.co:5432/postgres';

const MIGRATION_FILE = path.join(__dirname, '..', 'supabase', 'migrations', '20251022131000_create_polymarket_tables.sql');
const SEED_FILE = path.join(__dirname, '..', 'supabase', 'seed', 'polymarket-test-data.sql');

// Check if --with-seed flag is passed
const shouldLoadSeed = process.argv.includes('--with-seed');

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('');
  log(`${'='.repeat(70)}`, 'cyan');
  log(title, 'bright');
  log(`${'='.repeat(70)}`, 'cyan');
}

async function executeSQL(client, sql, description) {
  try {
    log(`  Executing: ${description}...`, 'blue');
    const result = await client.query(sql);

    // Log notices from PostgreSQL (RAISE NOTICE statements)
    if (result.notices && result.notices.length > 0) {
      result.notices.forEach(notice => {
        log(`    NOTICE: ${notice.message}`, 'yellow');
      });
    }

    log(`  ✓ Success: ${description}`, 'green');
    return result;
  } catch (error) {
    log(`  ✗ Error: ${description}`, 'red');
    throw error;
  }
}

async function verifySchema(client) {
  logSection('VERIFYING SCHEMA');

  // Check tables exist
  log('  Checking tables...', 'blue');
  const tableQuery = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('markets', 'sync_logs')
    ORDER BY table_name;
  `;
  const tables = await client.query(tableQuery);

  if (tables.rows.length === 2) {
    log(`  ✓ Tables created: ${tables.rows.map(r => r.table_name).join(', ')}`, 'green');
  } else {
    log(`  ✗ Expected 2 tables, found ${tables.rows.length}`, 'red');
    return false;
  }

  // Check indexes exist
  log('  Checking indexes...', 'blue');
  const indexQuery = `
    SELECT
      tablename,
      indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('markets', 'sync_logs')
    ORDER BY tablename, indexname;
  `;
  const indexes = await client.query(indexQuery);
  log(`  ✓ Indexes created: ${indexes.rows.length} indexes`, 'green');
  indexes.rows.forEach(idx => {
    log(`    - ${idx.tablename}.${idx.indexname}`, 'cyan');
  });

  // Check functions exist
  log('  Checking functions...', 'blue');
  const functionQuery = `
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = 'public'
      AND routine_name LIKE '%market%'
    ORDER BY routine_name;
  `;
  const functions = await client.query(functionQuery);
  log(`  ✓ Functions created: ${functions.rows.length} functions`, 'green');
  functions.rows.forEach(fn => {
    log(`    - ${fn.routine_name}()`, 'cyan');
  });

  // Check triggers exist
  log('  Checking triggers...', 'blue');
  const triggerQuery = `
    SELECT
      trigger_name,
      event_object_table
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table IN ('markets', 'sync_logs')
    ORDER BY trigger_name;
  `;
  const triggers = await client.query(triggerQuery);
  log(`  ✓ Triggers created: ${triggers.rows.length} triggers`, 'green');
  triggers.rows.forEach(trig => {
    log(`    - ${trig.event_object_table}.${trig.trigger_name}`, 'cyan');
  });

  // Check extension exists
  log('  Checking extensions...', 'blue');
  const extQuery = `
    SELECT extname
    FROM pg_extension
    WHERE extname = 'pg_trgm';
  `;
  const extensions = await client.query(extQuery);
  if (extensions.rows.length === 1) {
    log(`  ✓ Extension installed: pg_trgm`, 'green');
  } else {
    log(`  ✗ Extension pg_trgm not found`, 'red');
  }

  return true;
}

async function verifySeedData(client) {
  logSection('VERIFYING SEED DATA');

  // Count markets
  const marketCountQuery = 'SELECT COUNT(*) as count FROM markets;';
  const marketCount = await client.query(marketCountQuery);
  log(`  Markets: ${marketCount.rows[0].count} rows`, 'green');

  // Count sync logs
  const syncLogCountQuery = 'SELECT COUNT(*) as count FROM sync_logs;';
  const syncLogCount = await client.query(syncLogCountQuery);
  log(`  Sync logs: ${syncLogCount.rows[0].count} rows`, 'green');

  // Sample market data
  const sampleQuery = `
    SELECT
      market_id,
      title,
      category,
      volume_24h,
      active
    FROM markets
    ORDER BY volume_24h DESC
    LIMIT 5;
  `;
  const sampleMarkets = await client.query(sampleQuery);
  log('  Top 5 markets by volume:', 'blue');
  sampleMarkets.rows.forEach(m => {
    log(`    - [${m.category}] ${m.title.substring(0, 50)}...`, 'cyan');
    log(`      Volume: $${Number(m.volume_24h).toLocaleString()} | Active: ${m.active}`, 'cyan');
  });
}

async function main() {
  logSection('POLYMARKET SCHEMA MIGRATION');

  log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`, 'blue');
  log(`Migration file: ${MIGRATION_FILE}`, 'blue');
  log(`Load seed data: ${shouldLoadSeed ? 'YES' : 'NO'}`, 'blue');

  // Check if files exist
  if (!fs.existsSync(MIGRATION_FILE)) {
    log(`✗ Migration file not found: ${MIGRATION_FILE}`, 'red');
    process.exit(1);
  }

  if (shouldLoadSeed && !fs.existsSync(SEED_FILE)) {
    log(`✗ Seed file not found: ${SEED_FILE}`, 'red');
    process.exit(1);
  }

  // Create database client
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // Supabase requires SSL
    }
  });

  try {
    // Connect to database
    logSection('CONNECTING TO DATABASE');
    await client.connect();
    log('  ✓ Connected successfully', 'green');

    // Read migration SQL
    logSection('APPLYING MIGRATION');
    const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');
    log(`  Migration SQL size: ${(migrationSQL.length / 1024).toFixed(2)} KB`, 'blue');

    // Execute migration
    await executeSQL(client, migrationSQL, 'Create Polymarket schema (tables, indexes, functions)');

    // Load seed data if requested
    if (shouldLoadSeed) {
      logSection('LOADING SEED DATA');
      const seedSQL = fs.readFileSync(SEED_FILE, 'utf8');
      log(`  Seed SQL size: ${(seedSQL.length / 1024).toFixed(2)} KB`, 'blue');
      await executeSQL(client, seedSQL, 'Insert test data (markets and sync logs)');

      // Verify seed data
      await verifySeedData(client);
    }

    // Verify schema
    const verified = await verifySchema(client);

    // Summary
    logSection('MIGRATION SUMMARY');
    if (verified) {
      log('  ✓ Migration completed successfully!', 'green');
      log('  ✓ All schema objects created', 'green');
      if (shouldLoadSeed) {
        log('  ✓ Test data loaded', 'green');
      }
      log('', 'reset');
      log('Next steps:', 'bright');
      log('  1. Review the schema in Supabase Dashboard', 'blue');
      log('  2. Test queries against the database', 'blue');
      log('  3. Integrate with your application', 'blue');
    } else {
      log('  ✗ Migration completed with warnings', 'yellow');
      log('  Please review the verification output above', 'yellow');
    }

  } catch (error) {
    logSection('ERROR');
    log(`  ✗ Migration failed: ${error.message}`, 'red');
    if (error.stack) {
      log('', 'reset');
      log('Stack trace:', 'red');
      log(error.stack, 'red');
    }
    process.exit(1);
  } finally {
    // Close connection
    await client.end();
    log('', 'reset');
    log('Database connection closed', 'blue');
  }
}

// Run migration
main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
