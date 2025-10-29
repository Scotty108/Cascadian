#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration to Supabase
 *
 * This script applies the copy trading tables migration directly to the Supabase database.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import pg from 'pg'
import * as fs from 'fs'

const { Pool } = pg

async function main() {
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL

  if (!connectionString) {
    console.error('❌ Error: POSTGRES_URL or DATABASE_URL not found in .env.local')
    process.exit(1)
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  })

  try {
    console.log('📋 Applying Copy Trading Migration')
    console.log('====================================\n')

    const migrationPath = resolve(
      process.cwd(),
      'supabase/migrations/20251029000001_create_copy_trading_tables.sql'
    )

    console.log(`Reading migration from: ${migrationPath}\n`)

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8')

    console.log('Executing migration SQL...\n')
    await pool.query(migrationSQL)

    console.log('✅ Migration applied successfully!\n')

    // Verify tables
    console.log('🔍 Verifying tables...\n')

    const tables = [
      'tracked_wallets',
      'copy_trade_signals',
      'copy_trades',
      'copy_trade_performance_snapshots'
    ]

    for (const table of tables) {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      `, [table])

      const exists = parseInt(result.rows[0].count) > 0
      console.log(`  ${exists ? '✅' : '❌'} ${table}`)

      if (exists) {
        // Get column count
        const colResult = await pool.query(`
          SELECT COUNT(*) as count
          FROM information_schema.columns
          WHERE table_name = $1
        `, [table])
        console.log(`     Columns: ${colResult.rows[0].count}`)
      }
    }

    // Verify views
    console.log('\n🔍 Verifying views...\n')

    const views = [
      'v_active_copy_trades',
      'v_strategy_copy_performance',
      'v_owrr_decision_quality'
    ]

    for (const view of views) {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.views
        WHERE table_schema = 'public'
          AND table_name = $1
      `, [view])

      const exists = parseInt(result.rows[0].count) > 0
      console.log(`  ${exists ? '✅' : '❌'} ${view}`)
    }

    // Verify triggers
    console.log('\n🔍 Verifying triggers...\n')

    const triggers = [
      { table: 'tracked_wallets', trigger: 'tracked_wallets_update_timestamp' },
      { table: 'copy_trades', trigger: 'copy_trades_update_timestamp' },
      { table: 'copy_trades', trigger: 'update_tracked_wallet_stats_trigger' }
    ]

    for (const { table, trigger } of triggers) {
      const result = await pool.query(`
        SELECT COUNT(*) as count
        FROM information_schema.triggers
        WHERE event_object_table = $1
          AND trigger_name = $2
      `, [table, trigger])

      const exists = parseInt(result.rows[0].count) > 0
      console.log(`  ${exists ? '✅' : '❌'} ${trigger} (on ${table})`)
    }

    console.log('\n' + '='.repeat(60))
    console.log('✅ Migration Complete!')
    console.log('='.repeat(60) + '\n')

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()
