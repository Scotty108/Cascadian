#!/usr/bin/env tsx
/**
 * Apply Copy Trading Migration using Supabase Client
 *
 * This script applies the migration by executing SQL via Supabase client.
 * Note: Supabase JS client has limitations for DDL operations.
 * This approach requires executing statements individually.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Missing Supabase credentials')
  process.exit(1)
}

async function main() {
  console.log('📋 Copy Trading Migration - Manual Application Required')
  console.log('====================================\n')

  const migrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20251029000001_create_copy_trading_tables.sql'
  )

  const migrationSQL = fs.readFileSync(migrationPath, 'utf-8')

  console.log('⚠️  The Supabase JS client cannot execute complex DDL migrations.\n')
  console.log('Please apply this migration manually using one of these methods:\n')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('METHOD 1: Supabase SQL Editor (Recommended)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
  const sqlEditorUrl = `https://supabase.com/dashboard/project/${projectRef}/sql/new`

  console.log(`1. Open SQL Editor: ${sqlEditorUrl}`)
  console.log(`2. Copy the migration SQL from: ${migrationPath}`)
  console.log('3. Paste and execute in the SQL Editor')
  console.log('4. Run the verification script: npm run verify:copy-trading\n')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('METHOD 2: Direct psql Connection')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  console.log('You need the database password from Supabase Dashboard:')
  console.log(`1. Go to: https://supabase.com/dashboard/project/${projectRef}/settings/database`)
  console.log('2. Copy the connection string (with password)')
  console.log('3. Run: psql "postgresql://[connection-string]" < supabase/migrations/20251029000001_create_copy_trading_tables.sql\n')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('METHOD 3: Add to .env.local and use pg client')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  console.log('1. Get the connection string from Supabase Dashboard')
  console.log('2. Add to .env.local: DATABASE_URL="postgresql://..."')
  console.log('3. Run: npx tsx scripts/apply-copy-trading-migration-direct.ts\n')

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Still run verification to show current state
  console.log('📊 Current Database State:\n')

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const tables = [
    'tracked_wallets',
    'copy_trade_signals',
    'copy_trades',
    'copy_trade_performance_snapshots'
  ]

  let allExist = true

  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })

    if (error) {
      console.log(`  ❌ ${table}: NOT FOUND`)
      allExist = false
    } else {
      console.log(`  ✅ ${table}: EXISTS`)
    }
  }

  console.log('')

  if (allExist) {
    console.log('✅ All tables already exist! Migration has been applied.\n')
    console.log('Run verification: npm run verify:copy-trading\n')
  } else {
    console.log('❌ Migration not yet applied. Please use one of the methods above.\n')
  }
}

main()
