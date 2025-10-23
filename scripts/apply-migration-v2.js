#!/usr/bin/env node

/**
 * Migration Script v2: Apply Polymarket Schema to Supabase
 *
 * This version uses direct PostgreSQL connection with proper SSL handling.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Direct connection parameters (more reliable than connection string)
const DB_CONFIG = {
  host: 'db.cqvjfonlpqycmaonacvz.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'EwchTep6Zw97GLw',
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000
};

const MIGRATION_FILE = path.join(__dirname, '..', 'supabase', 'migrations', '20251022131000_create_polymarket_tables.sql');
const SEED_FILE = path.join(__dirname, '..', 'supabase', 'seed', 'polymarket-test-data.sql');
const shouldLoadSeed = process.argv.includes('--with-seed');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = (msg, color = 'reset') => console.log(`${c[color]}${msg}${c.reset}`);
const section = (title) => {
  console.log('');
  log('='.repeat(70), 'cyan');
  log(title, 'bright');
  log('='.repeat(70), 'cyan');
};

async function main() {
  section('POLYMARKET SCHEMA MIGRATION');

  log(`Host: ${DB_CONFIG.host}`, 'blue');
  log(`Database: ${DB_CONFIG.database}`, 'blue');
  log(`Load seed: ${shouldLoadSeed ? 'YES' : 'NO'}`, 'blue');

  // Check files
  if (!fs.existsSync(MIGRATION_FILE)) {
    log(`✗ Migration file not found: ${MIGRATION_FILE}`, 'red');
    process.exit(1);
  }

  const client = new Client(DB_CONFIG);

  try {
    // Connect
    section('CONNECTING');
    log('  Connecting to Supabase PostgreSQL...', 'blue');
    await client.connect();
    log('  ✓ Connected successfully', 'green');

    // Test connection
    const testResult = await client.query('SELECT version();');
    log(`  PostgreSQL version: ${testResult.rows[0].version.split(' ')[1]}`, 'cyan');

    // Read and execute migration
    section('APPLYING MIGRATION');
    const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');
    log(`  SQL size: ${(migrationSQL.length / 1024).toFixed(2)} KB`, 'blue');

    log('  Executing migration...', 'blue');
    await client.query(migrationSQL);
    log('  ✓ Migration executed', 'green');

    // Load seed data
    if (shouldLoadSeed) {
      section('LOADING SEED DATA');
      const seedSQL = fs.readFileSync(SEED_FILE, 'utf8');
      log(`  SQL size: ${(seedSQL.length / 1024).toFixed(2)} KB`, 'blue');

      log('  Executing seed...', 'blue');
      await client.query(seedSQL);
      log('  ✓ Seed data loaded', 'green');
    }

    // Verify tables
    section('VERIFICATION');

    log('  Checking tables...', 'blue');
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('markets', 'sync_logs')
      ORDER BY table_name;
    `);
    log(`  ✓ Tables: ${tablesResult.rows.map(r => r.table_name).join(', ')}`, 'green');

    log('  Checking indexes...', 'blue');
    const indexesResult = await client.query(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN ('markets', 'sync_logs')
      ORDER BY tablename, indexname;
    `);
    log(`  ✓ Indexes: ${indexesResult.rows.length} created`, 'green');
    indexesResult.rows.forEach(idx => {
      log(`    - ${idx.tablename}.${idx.indexname}`, 'cyan');
    });

    log('  Checking functions...', 'blue');
    const functionsResult = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name LIKE '%market%'
      ORDER BY routine_name;
    `);
    log(`  ✓ Functions: ${functionsResult.rows.length} created`, 'green');
    functionsResult.rows.forEach(fn => {
      log(`    - ${fn.routine_name}()`, 'cyan');
    });

    log('  Checking triggers...', 'blue');
    const triggersResult = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
        AND event_object_table IN ('markets', 'sync_logs')
      ORDER BY trigger_name;
    `);
    log(`  ✓ Triggers: ${triggersResult.rows.length} created`, 'green');
    triggersResult.rows.forEach(trig => {
      log(`    - ${trig.event_object_table}.${trig.trigger_name}`, 'cyan');
    });

    // Check data
    if (shouldLoadSeed) {
      log('  Checking data...', 'blue');

      const marketCountResult = await client.query('SELECT COUNT(*) FROM markets;');
      log(`  ✓ Markets: ${marketCountResult.rows[0].count} rows`, 'green');

      const syncCountResult = await client.query('SELECT COUNT(*) FROM sync_logs;');
      log(`  ✓ Sync logs: ${syncCountResult.rows[0].count} rows`, 'green');

      const topMarketsResult = await client.query(`
        SELECT title, category, volume_24h, active
        FROM markets
        ORDER BY volume_24h DESC
        LIMIT 5;
      `);

      log('  Top 5 markets by volume:', 'blue');
      topMarketsResult.rows.forEach(m => {
        const vol = Number(m.volume_24h).toLocaleString();
        log(`    - [${m.category}] ${m.title.substring(0, 45)}...`, 'cyan');
        log(`      $${vol} | Active: ${m.active}`, 'cyan');
      });
    }

    // Summary
    section('SUCCESS');
    log('  ✓ Migration completed successfully', 'green');
    log('  ✓ Schema created and verified', 'green');
    if (shouldLoadSeed) {
      log('  ✓ Test data loaded', 'green');
    }

    log('', 'reset');
    log('Next steps:', 'bright');
    log('  1. View tables in Supabase Dashboard', 'blue');
    log('  2. Test queries in your application', 'blue');
    log('  3. Set up RLS policies if needed', 'blue');

  } catch (error) {
    section('ERROR');
    log(`  ✗ ${error.message}`, 'red');
    if (error.stack) {
      log('', 'reset');
      log(error.stack, 'red');
    }
    process.exit(1);
  } finally {
    await client.end();
    log('', 'reset');
    log('Connection closed', 'blue');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
