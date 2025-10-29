#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration to Supabase via HTTP API
 *
 * This script reads and applies the copy trading tables migration
 * to the Supabase PostgreSQL database using the HTTP API.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Construct API endpoint
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Error: Missing Supabase credentials');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!SUPABASE_URL);
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!SUPABASE_SERVICE_KEY);
  process.exit(1);
}

async function executeSQLViaAPI(sql: string): Promise<any> {
  // Use Supabase's REST API PostgREST to execute SQL
  // Unfortunately, PostgREST doesn't allow direct SQL execution for security reasons
  // We need to break down the migration into individual API calls

  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({ query: sql })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function applyMigration() {
  console.log('📋 Copy Trading Migration Script (API Method)');
  console.log('===============================================\n');

  // Read the migration file
  const migrationPath = join(process.cwd(), 'supabase', 'migrations', '20251029000001_create_copy_trading_tables.sql');
  console.log(`📂 Reading migration file: ${migrationPath}`);

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(migrationPath, 'utf-8');
    console.log(`✅ Migration file loaded (${migrationSQL.length} characters)\n`);
  } catch (error) {
    console.error('❌ Failed to read migration file:', error);
    process.exit(1);
  }

  console.log('⚠️  Direct SQL execution via API is not available.');
  console.log('ℹ️  You can apply this migration in two ways:\n');
  console.log('   1. Using Supabase Dashboard:');
  console.log('      - Go to: https://app.supabase.com/project/cqvjfonlpqycmaonacvz/sql');
  console.log('      - Copy and paste the SQL from:');
  console.log(`        ${migrationPath}`);
  console.log('      - Click "Run"\n');
  console.log('   2. Using psql command line:');
  console.log('      - Install PostgreSQL client tools');
  console.log('      - Run: psql "postgresql://postgres:[PASSWORD]@db.cqvjfonlpqycmaonacvz.supabase.co:6543/postgres" -f supabase/migrations/20251029000001_create_copy_trading_tables.sql\n');
  console.log('   3. Using Supabase CLI (requires Docker):');
  console.log('      - supabase db push\n');

  console.log('📋 Migration SQL preview (first 500 chars):');
  console.log('─'.repeat(60));
  console.log(migrationSQL.substring(0, 500) + '...');
  console.log('─'.repeat(60));
}

// Run the migration info
applyMigration().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
