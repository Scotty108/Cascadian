/**
 * Apply migrations directly via Supabase SQL execution
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function runMigrations() {
  console.log('🚀 Running Database Migrations\n')

  try {
    // Migration 1: wallet_scores_by_category
    console.log('📄 Migration 1: Create wallet_scores_by_category table')
    const migration1SQL = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20251024240000_create_wallet_scores_by_category.sql'),
      'utf-8'
    )

    // Execute via raw SQL
    const { error: error1 } = await supabase.rpc('exec', { sql_query: migration1SQL })

    if (error1) {
      console.log('   ⚠️  Could not execute via RPC, trying alternative method...')
      // Try to check if table exists instead
      const { data, error: checkError } = await supabase
        .from('wallet_scores_by_category')
        .select('id')
        .limit(1)

      if (checkError) {
        console.log(`   ❌ Table does not exist yet. Please run via Supabase Dashboard SQL Editor.`)
        console.log(`   📋 Copy the SQL from: supabase/migrations/20251024240000_create_wallet_scores_by_category.sql`)
      } else {
        console.log('   ✅ Table wallet_scores_by_category exists')
      }
    } else {
      console.log('   ✅ Migration 1 applied successfully')
    }

    // Migration 2: wallet_tracking_criteria
    console.log('\n📄 Migration 2: Create wallet_tracking_criteria table')
    const migration2SQL = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20251024240001_create_wallet_tracking_criteria.sql'),
      'utf-8'
    )

    const { error: error2 } = await supabase.rpc('exec', { sql_query: migration2SQL })

    if (error2) {
      console.log('   ⚠️  Could not execute via RPC, trying alternative method...')
      const { data, error: checkError } = await supabase
        .from('wallet_tracking_criteria')
        .select('id')
        .limit(1)

      if (checkError) {
        console.log(`   ❌ Table does not exist yet. Please run via Supabase Dashboard SQL Editor.`)
        console.log(`   📋 Copy the SQL from: supabase/migrations/20251024240001_create_wallet_tracking_criteria.sql`)
      } else {
        console.log('   ✅ Table wallet_tracking_criteria exists')
      }
    } else {
      console.log('   ✅ Migration 2 applied successfully')
    }

    console.log('\n✅ Migration check complete!')
    console.log('\n💡 If tables do not exist, apply the SQL files manually via Supabase Dashboard.')

  } catch (error) {
    console.error('❌ Error during migration:', error)
  }
}

runMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
