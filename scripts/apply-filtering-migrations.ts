/**
 * Apply Wallet Filtering System Migrations
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

async function applyMigrations() {
  console.log('🚀 Applying Wallet Filtering System Migrations\n')

  try {
    // Read migration files
    const migration1 = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20251024240000_create_wallet_scores_by_category.sql'),
      'utf-8'
    )
    const migration2 = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20251024240001_create_wallet_tracking_criteria.sql'),
      'utf-8'
    )

    console.log('📄 Migration 1: Create wallet_scores_by_category table')
    const { error: error1 } = await supabase.rpc('exec_sql', { sql: migration1 })
    if (error1) {
      console.log('   Note: This may fail if using rpc. Run manually via Supabase dashboard SQL editor.')
      console.log('   ✓ Migration file ready at: supabase/migrations/20251024240000_create_wallet_scores_by_category.sql')
    } else {
      console.log('   ✅ Applied successfully')
    }

    console.log('\n📄 Migration 2: Create wallet_tracking_criteria table')
    const { error: error2 } = await supabase.rpc('exec_sql', { sql: migration2 })
    if (error2) {
      console.log('   Note: This may fail if using rpc. Run manually via Supabase dashboard SQL editor.')
      console.log('   ✓ Migration file ready at: supabase/migrations/20251024240001_create_wallet_tracking_criteria.sql')
    } else {
      console.log('   ✅ Applied successfully')
    }

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('                MIGRATION INSTRUCTIONS                      ')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log('If automatic migration failed, apply manually:')
    console.log('\n1. Go to your Supabase Dashboard')
    console.log('2. Navigate to SQL Editor')
    console.log('3. Run the contents of these files:\n')
    console.log('   • supabase/migrations/20251024240000_create_wallet_scores_by_category.sql')
    console.log('   • supabase/migrations/20251024240001_create_wallet_tracking_criteria.sql')
    console.log('\n✅ Migrations ready!\n')

  } catch (error) {
    console.error('❌ Error applying migrations:', error)
    console.log('\n📋 Manual migration required.')
    console.log('   Copy the SQL from the migration files and run in Supabase SQL Editor.')
  }
}

applyMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
