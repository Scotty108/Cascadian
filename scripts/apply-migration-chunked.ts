#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration via Supabase Management API (Chunked)
 *
 * Splits the migration into smaller chunks to avoid timeouts
 */

import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

// Sleep utility
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function executeSQL(projectRef: string, accessToken: string, sql: string, description: string): Promise<boolean> {
  console.log(`   Executing: ${description}...`);

  try {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: sql
        })
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`   ❌ Failed: ${description}`);
      console.error(`   Status: ${response.status} ${response.statusText}`);
      console.error(`   Response:`, responseText);
      return false;
    }

    console.log(`   ✓ Success: ${description}`);
    return true;

  } catch (error: any) {
    console.error(`   ❌ Error: ${description}`);
    console.error(`   Message:`, error.message);
    return false;
  }
}

async function applyMigration() {
  console.log('🚀 Starting chunked migration application...\n');

  const projectRef = 'cqvjfonlpqycmaonacvz';
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

  // Split migration into logical chunks
  console.log('⚡ Splitting migration into chunks...\n');

  const chunks = [
    {
      name: 'Table 1: tracked_wallets',
      sql: migrationSQL.substring(
        migrationSQL.indexOf('CREATE TABLE IF NOT EXISTS tracked_wallets'),
        migrationSQL.indexOf('-- ============================================================\n-- Table 2:')
      )
    },
    {
      name: 'Table 2: copy_trade_signals',
      sql: migrationSQL.substring(
        migrationSQL.indexOf('CREATE TABLE IF NOT EXISTS copy_trade_signals'),
        migrationSQL.indexOf('-- ============================================================\n-- Table 3:')
      )
    },
    {
      name: 'Table 3: copy_trades',
      sql: migrationSQL.substring(
        migrationSQL.indexOf('CREATE TABLE IF NOT EXISTS copy_trades'),
        migrationSQL.indexOf('-- Add foreign key constraint')
      )
    },
    {
      name: 'Foreign Key: copy_trade_signals',
      sql: migrationSQL.substring(
        migrationSQL.indexOf('ALTER TABLE copy_trade_signals'),
        migrationSQL.indexOf('-- ============================================================\n-- Table 4:')
      )
    },
    {
      name: 'Table 4: copy_trade_performance_snapshots',
      sql: migrationSQL.substring(
        migrationSQL.indexOf('CREATE TABLE IF NOT EXISTS copy_trade_performance_snapshots'),
        migrationSQL.indexOf('-- ============================================================\n-- Update Triggers')
      )
    },
    {
      name: 'Triggers and Functions',
      sql: migrationSQL.substring(
        migrationSQL.indexOf('-- Update timestamp on tracked_wallets'),
        migrationSQL.indexOf('-- ============================================================\n-- Helpful Views')
      )
    },
    {
      name: 'Views',
      sql: migrationSQL.substring(
        migrationSQL.indexOf('-- View: Active copy trades with performance'),
        migrationSQL.indexOf('-- ============================================================\n-- Sample Queries')
      )
    }
  ];

  console.log(`   Found ${chunks.length} chunks to execute\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`\n[${i + 1}/${chunks.length}] ${chunk.name}`);
    console.log('─'.repeat(60));

    const success = await executeSQL(projectRef, accessToken, chunk.sql, chunk.name);

    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Wait a bit between chunks to avoid rate limiting
    if (i < chunks.length - 1) {
      await sleep(1000);
    }
  }

  console.log('\n');
  console.log('═'.repeat(60));
  console.log(`📊 Migration Results: ${successCount} succeeded, ${failCount} failed`);
  console.log('═'.repeat(60));

  if (failCount === 0) {
    console.log('\n✅ MIGRATION APPLIED SUCCESSFULLY!\n');
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
    console.log('   - update_tracked_wallet_stats_trigger\n');
  } else {
    console.log('\n❌ MIGRATION INCOMPLETE\n');
    console.log(`${failCount} chunk(s) failed to execute.`);
    console.log('Please review the errors above and try again.\n');
    process.exit(1);
  }
}

// Run the migration
applyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
