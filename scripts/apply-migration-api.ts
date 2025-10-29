#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration via Supabase Management API
 *
 * Uses the Supabase Management API to execute SQL migrations
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

async function applyMigration() {
  console.log('🚀 Starting migration application via Supabase Management API...\n');

  const projectRef = 'cqvjfonlpqycmaonacvz'; // From .env.local
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (!accessToken) {
    console.error('❌ Missing SUPABASE_ACCESS_TOKEN environment variable');
    process.exit(1);
  }

  console.log('📊 Configuration:');
  console.log('   Project Ref:', projectRef);
  console.log('   Access Token:', accessToken.substring(0, 20) + '...');
  console.log('');

  // Read the migration file
  const migrationPath = join(process.cwd(), 'supabase/migrations/20251029000001_create_copy_trading_tables.sql');
  console.log('📄 Reading migration file:', migrationPath);

  let migrationSQL: string;
  try {
    migrationSQL = readFileSync(migrationPath, 'utf-8');
    console.log('✓ Migration file loaded successfully');
    console.log(`  Lines: ${migrationSQL.split('\n').length}`);
    console.log(`  Size: ${(migrationSQL.length / 1024).toFixed(2)} KB`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to read migration file:', error);
    process.exit(1);
  }

  try {
    console.log('⚡ Executing migration SQL via Management API...');
    console.log('   Endpoint: POST /projects/{ref}/database/query\n');

    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: migrationSQL
        })
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error('❌ API request failed!');
      console.error('   Status:', response.status, response.statusText);
      console.error('   Response:', responseText);

      // Try to parse as JSON for better error details
      try {
        const errorData = JSON.parse(responseText);
        console.error('   Error details:', JSON.stringify(errorData, null, 2));
      } catch {
        // Response wasn't JSON
      }

      process.exit(1);
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = responseText;
    }

    console.log('✅ MIGRATION APPLIED SUCCESSFULLY!\n');
    console.log('Response:', result);
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎉 Copy trading tables created:');
    console.log('   1. tracked_wallets');
    console.log('   2. copy_trade_signals');
    console.log('   3. copy_trades');
    console.log('   4. copy_trade_performance_snapshots');
    console.log('');
    console.log('📊 Views created:');
    console.log('   - v_active_copy_trades');
    console.log('   - v_strategy_copy_performance');
    console.log('   - v_owrr_decision_quality');
    console.log('');
    console.log('🔧 Triggers created:');
    console.log('   - tracked_wallets_update_timestamp');
    console.log('   - copy_trades_update_timestamp');
    console.log('   - update_tracked_wallet_stats_trigger');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error: any) {
    console.error('\n❌ MIGRATION FAILED!\n');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the migration
applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
