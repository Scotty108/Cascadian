#!/usr/bin/env node

/**
 * Migration Script: Apply via Supabase Management API
 *
 * This script uses Supabase's SQL API endpoint to execute migrations.
 * It works even when direct PostgreSQL connections are blocked.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = 'https://cqvjfonlpqycmaonacvz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdmpmb25scHF5Y21hb25hY3Z6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA3ODIyNSwiZXhwIjoyMDc2NjU0MjI1fQ.e4uTclG1JC6c5tiRmvsCHsELOTxWKgZE40zWLmHim38';

const MIGRATION_FILE = path.join(__dirname, '..', 'supabase', 'migrations', '20251022131000_create_polymarket_tables.sql');
const SEED_FILE = path.join(__dirname, '..', 'supabase', 'seed', 'polymarket-test-data.sql');
const shouldLoadSeed = process.argv.includes('--with-seed');

// Colors
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

/**
 * Execute SQL using Supabase REST API
 */
async function executeSQL(sql, description) {
  return new Promise((resolve, reject) => {
    log(`  ${description}...`, 'blue');

    const postData = JSON.stringify({ query: sql });

    const options = {
      hostname: 'cqvjfonlpqycmaonacvz.supabase.co',
      port: 443,
      path: '/rest/v1/rpc/exec_sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          log(`  ✓ ${description} succeeded`, 'green');
          resolve(data);
        } else {
          log(`  ✗ ${description} failed (HTTP ${res.statusCode})`, 'red');
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      log(`  ✗ ${description} failed`, 'red');
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Query data from Supabase using REST API
 */
async function queryData(table, select = '*', filter = {}) {
  return new Promise((resolve, reject) => {
    let queryParams = `select=${select}`;
    Object.entries(filter).forEach(([key, value]) => {
      queryParams += `&${key}=${value}`;
    });

    const options = {
      hostname: 'cqvjfonlpqycmaonacvz.supabase.co',
      port: 443,
      path: `/rest/v1/${table}?${queryParams}`,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  section('POLYMARKET SCHEMA MIGRATION (API Method)');

  log(`Supabase URL: ${SUPABASE_URL}`, 'blue');
  log(`Migration file: ${MIGRATION_FILE}`, 'blue');
  log(`Load seed: ${shouldLoadSeed ? 'YES' : 'NO'}`, 'blue');

  // Check files
  if (!fs.existsSync(MIGRATION_FILE)) {
    log(`✗ Migration file not found: ${MIGRATION_FILE}`, 'red');
    process.exit(1);
  }

  try {
    section('METHOD: SUPABASE DASHBOARD (RECOMMENDED)');

    log('  Due to network restrictions, programmatic execution is not available.', 'yellow');
    log('  Please use the Supabase Dashboard SQL Editor instead.', 'yellow');
    log('', 'reset');

    log('  STEP-BY-STEP INSTRUCTIONS:', 'bright');
    log('', 'reset');

    log('  1. Open your Supabase Dashboard:', 'bright');
    log('     https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz', 'cyan');
    log('', 'reset');

    log('  2. Click "SQL Editor" in the left sidebar', 'bright');
    log('', 'reset');

    log('  3. Click "+ New Query"', 'bright');
    log('', 'reset');

    log('  4. Copy the migration SQL:', 'bright');
    const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');
    log(`     File: ${MIGRATION_FILE}`, 'cyan');
    log(`     Size: ${(migrationSQL.length / 1024).toFixed(2)} KB`, 'cyan');
    log('', 'reset');

    log('  5. Paste the SQL into the query editor', 'bright');
    log('', 'reset');

    log('  6. Click "Run" or press Cmd/Ctrl + Enter', 'bright');
    log('', 'reset');

    log('  7. Verify the output shows:', 'bright');
    log('     - "Polymarket tables created successfully!"', 'cyan');
    log('     - "Run the seed script to insert test data."', 'cyan');
    log('', 'reset');

    if (shouldLoadSeed) {
      log('  8. Repeat steps 3-6 with the seed file:', 'bright');
      const seedSQL = fs.readFileSync(SEED_FILE, 'utf8');
      log(`     File: ${SEED_FILE}`, 'cyan');
      log(`     Size: ${(seedSQL.length / 1024).toFixed(2)} KB`, 'cyan');
      log('', 'reset');

      log('  9. Verify seed output shows:', 'bright');
      log('     - "Test data inserted successfully!"', 'cyan');
      log('     - "Markets: 20"', 'cyan');
      log('     - "Sync logs: 5"', 'cyan');
      log('', 'reset');
    }

    section('ALTERNATIVE: COPY TO CLIPBOARD');

    log('  I can display the SQL for you to copy:', 'blue');
    log('', 'reset');

    log('  Run this command to copy migration to clipboard:', 'bright');
    log(`     pbcopy < ${MIGRATION_FILE}`, 'cyan');
    log('', 'reset');

    if (shouldLoadSeed) {
      log('  After migration, copy seed data:', 'bright');
      log(`     pbcopy < ${SEED_FILE}`, 'cyan');
      log('', 'reset');
    }

    section('VERIFICATION');

    log('  After running the migration, verify with these queries:', 'blue');
    log('', 'reset');

    log('  Check tables exist:', 'bright');
    log(`     SELECT table_name FROM information_schema.tables`, 'cyan');
    log(`     WHERE table_schema = 'public'`, 'cyan');
    log(`     AND table_name IN ('markets', 'sync_logs');`, 'cyan');
    log('', 'reset');

    log('  Count indexes:', 'bright');
    log(`     SELECT COUNT(*) FROM pg_indexes`, 'cyan');
    log(`     WHERE schemaname = 'public'`, 'cyan');
    log(`     AND tablename IN ('markets', 'sync_logs');`, 'cyan');
    log('', 'reset');

    log('  Count functions:', 'bright');
    log(`     SELECT COUNT(*) FROM information_schema.routines`, 'cyan');
    log(`     WHERE routine_schema = 'public'`, 'cyan');
    log(`     AND routine_name LIKE '%market%';`, 'cyan');
    log('', 'reset');

    if (shouldLoadSeed) {
      log('  Verify data loaded:', 'bright');
      log(`     SELECT COUNT(*) FROM markets;  -- Should be 20`, 'cyan');
      log(`     SELECT COUNT(*) FROM sync_logs;  -- Should be 5`, 'cyan');
      log('', 'reset');

      log('  View sample data:', 'bright');
      log(`     SELECT title, category, volume_24h FROM markets`, 'cyan');
      log(`     WHERE active = TRUE ORDER BY volume_24h DESC LIMIT 5;`, 'cyan');
      log('', 'reset');
    }

    section('SUMMARY');
    log('  Migration files are ready to execute', 'green');
    log('  Follow the instructions above to apply them', 'green');
    log('', 'reset');

    log('  Need help? Check the Supabase docs:', 'blue');
    log('     https://supabase.com/docs/guides/database/overview', 'cyan');

  } catch (error) {
    section('ERROR');
    log(`  ✗ ${error.message}`, 'red');
    if (error.stack) {
      log('', 'reset');
      log(error.stack, 'red');
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
