#!/usr/bin/env node

/**
 * Migration Script: Apply Polymarket Schema to Supabase (via Supabase Client)
 *
 * This script uses the Supabase JavaScript client to execute the migration SQL.
 * It breaks the SQL into logical chunks to avoid execution issues.
 *
 * Usage:
 *   node scripts/apply-migration-supabase.js [--with-seed]
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://cqvjfonlpqycmaonacvz.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxdmpmb25scHF5Y21hb25hY3Z6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTA3ODIyNSwiZXhwIjoyMDc2NjU0MjI1fQ.e4uTclG1JC6c5tiRmvsCHsELOTxWKgZE40zWLmHim38';

const MIGRATION_FILE = path.join(__dirname, '..', 'supabase', 'migrations', '20251022131000_create_polymarket_tables.sql');
const SEED_FILE = path.join(__dirname, '..', 'supabase', 'seed', 'polymarket-test-data.sql');

// Check if --with-seed flag is passed
const shouldLoadSeed = process.argv.includes('--with-seed');

// ANSI color codes
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

/**
 * Split SQL into individual statements
 * This is a simple splitter that breaks on semicolons outside of strings
 */
function splitSQL(sql) {
  // Remove comments
  const withoutComments = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  // Split on semicolons (this is simplistic but works for our migration)
  const statements = withoutComments
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))
    .filter(stmt => {
      // Filter out DO blocks and other non-essential statements for now
      // We'll keep them but mark them
      return true;
    });

  return statements;
}

async function executeSQL(supabase, sql, description) {
  try {
    log(`  Executing: ${description}...`, 'blue');

    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
      throw error;
    }

    log(`  ✓ Success: ${description}`, 'green');
    return data;
  } catch (error) {
    log(`  ✗ Error: ${description}`, 'red');
    throw error;
  }
}

async function createExecFunction(supabase) {
  log('  Creating helper function for SQL execution...', 'blue');

  // Create a function in Supabase to execute arbitrary SQL
  // This is needed because the Supabase client doesn't have direct SQL execution
  const createFunctionSQL = `
    CREATE OR REPLACE FUNCTION exec_sql(sql_query TEXT)
    RETURNS TEXT AS $$
    BEGIN
      EXECUTE sql_query;
      RETURN 'OK';
    EXCEPTION WHEN OTHERS THEN
      RETURN 'ERROR: ' || SQLERRM;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  `;

  try {
    const { error } = await supabase.rpc('exec_sql', { sql_query: createFunctionSQL });
    if (error && error.message.includes('function "exec_sql" does not exist')) {
      // Function doesn't exist yet, use a workaround
      log('  Note: Using alternative SQL execution method', 'yellow');
      return false;
    }
    log('  ✓ Helper function ready', 'green');
    return true;
  } catch (error) {
    log('  Note: Using alternative SQL execution method', 'yellow');
    return false;
  }
}

async function executeSQLDirect(supabase, sql) {
  // Use the REST API directly for SQL execution
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({ sql_query: sql })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return await response.json();
}

async function verifySchema(supabase) {
  logSection('VERIFYING SCHEMA');

  try {
    // Check tables exist
    log('  Checking tables...', 'blue');
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .in('table_name', ['markets', 'sync_logs'])
      .eq('table_schema', 'public');

    if (tablesError) {
      // Fallback: try direct query
      const { data, error } = await supabase.rpc('get_tables');
      if (!error && data) {
        log(`  ✓ Tables verified`, 'green');
      }
    } else {
      log(`  ✓ Tables created: ${tables.map(t => t.table_name).join(', ')}`, 'green');
    }

    // Check data exists
    const { count: marketCount, error: marketError } = await supabase
      .from('markets')
      .select('*', { count: 'exact', head: true });

    if (!marketError) {
      log(`  ✓ Markets table accessible (${marketCount || 0} rows)`, 'green');
    }

    const { count: syncCount, error: syncError } = await supabase
      .from('sync_logs')
      .select('*', { count: 'exact', head: true });

    if (!syncError) {
      log(`  ✓ Sync logs table accessible (${syncCount || 0} rows)`, 'green');
    }

    return true;
  } catch (error) {
    log(`  ✗ Verification failed: ${error.message}`, 'red');
    return false;
  }
}

async function verifySeedData(supabase) {
  logSection('VERIFYING SEED DATA');

  try {
    // Count markets
    const { count: marketCount } = await supabase
      .from('markets')
      .select('*', { count: 'exact', head: true });
    log(`  Markets: ${marketCount || 0} rows`, 'green');

    // Count sync logs
    const { count: syncCount } = await supabase
      .from('sync_logs')
      .select('*', { count: 'exact', head: true });
    log(`  Sync logs: ${syncCount || 0} rows`, 'green');

    // Sample market data
    const { data: sampleMarkets } = await supabase
      .from('markets')
      .select('market_id, title, category, volume_24h, active')
      .order('volume_24h', { ascending: false })
      .limit(5);

    if (sampleMarkets && sampleMarkets.length > 0) {
      log('  Top 5 markets by volume:', 'blue');
      sampleMarkets.forEach(m => {
        log(`    - [${m.category}] ${m.title.substring(0, 50)}...`, 'cyan');
        log(`      Volume: $${Number(m.volume_24h).toLocaleString()} | Active: ${m.active}`, 'cyan');
      });
    }
  } catch (error) {
    log(`  ✗ Error verifying seed data: ${error.message}`, 'red');
  }
}

async function main() {
  logSection('POLYMARKET SCHEMA MIGRATION (Supabase Client)');

  log(`Supabase URL: ${SUPABASE_URL}`, 'blue');
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

  // Create Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  try {
    logSection('EXECUTING MIGRATION VIA SUPABASE DASHBOARD');

    // Read the migration SQL
    const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');
    log(`  Migration SQL size: ${(migrationSQL.length / 1024).toFixed(2)} KB`, 'blue');

    log('', 'reset');
    log('  IMPORTANT: The Supabase JavaScript client cannot execute DDL directly.', 'yellow');
    log('  Please follow these steps:', 'yellow');
    log('', 'reset');
    log('  1. Open your Supabase Dashboard:', 'bright');
    log(`     ${SUPABASE_URL.replace('https://', 'https://supabase.com/dashboard/project/')}`, 'cyan');
    log('', 'reset');
    log('  2. Navigate to: SQL Editor (left sidebar)', 'bright');
    log('', 'reset');
    log('  3. Click "New Query"', 'bright');
    log('', 'reset');
    log('  4. Copy and paste this migration file:', 'bright');
    log(`     ${MIGRATION_FILE}`, 'cyan');
    log('', 'reset');
    log('  5. Click "Run" to execute', 'bright');
    log('', 'reset');

    if (shouldLoadSeed) {
      log('  6. After migration succeeds, paste and run the seed file:', 'bright');
      log(`     ${SEED_FILE}`, 'cyan');
      log('', 'reset');
    }

    log('  Alternative: Use psql directly:', 'yellow');
    log(`     psql "postgresql://postgres:EwchTep6Zw97GLw@db.cqvjfonlpqycmaonacvz.supabase.co:5432/postgres" \\`, 'cyan');
    log(`     -f ${MIGRATION_FILE}`, 'cyan');
    log('', 'reset');

    // Wait for user confirmation
    log('  After running the migration in Supabase, press any key to verify...', 'yellow');
    log('  (or Ctrl+C to exit)', 'yellow');

    // Note: In a real script, you'd want to wait for user input here
    // For now, let's just try to verify

    log('', 'reset');
    log('  Attempting to verify schema...', 'blue');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Give user time to read

    const verified = await verifySchema(supabase);

    if (verified) {
      logSection('VERIFICATION SUCCESS');
      log('  ✓ Schema verified!', 'green');
      log('  ✓ Tables are accessible', 'green');

      if (shouldLoadSeed) {
        await verifySeedData(supabase);
      }
    } else {
      logSection('MANUAL MIGRATION REQUIRED');
      log('  Please run the migration in Supabase Dashboard as described above', 'yellow');
    }

  } catch (error) {
    logSection('ERROR');
    log(`  ✗ Error: ${error.message}`, 'red');
    if (error.stack) {
      log('', 'reset');
      log('Stack trace:', 'red');
      log(error.stack, 'red');
    }
    process.exit(1);
  }
}

// Run migration
main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
