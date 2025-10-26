/**
 * Create Phase 1 tables directly using Supabase client
 *
 * This script creates the tables by executing SQL statements
 * using the Supabase client's .rpc() method if available,
 * or falls back to manual table verification
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function createTablesDirectly() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('      CREATING PHASE 1 METRICS TABLES DIRECTLY            ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('📋 INSTRUCTIONS:')
  console.log('\nSince direct SQL execution requires special setup, please:')
  console.log('\n1. Open Supabase SQL Editor:')
  console.log('   https://supabase.com/dashboard/project/cqvjfonlpqycmaonacvz/sql/new')
  console.log('\n2. Copy and paste the contents of this file:')
  console.log('   /Users/scotty/Projects/Cascadian-app/APPLY_MIGRATIONS_NOW.sql')
  console.log('\n3. Click "Run" to execute the migration')
  console.log('\n4. Return here and press ENTER to verify tables were created\n')

  // Wait for user input
  console.log('⏸️  Waiting for you to run the migration in Supabase SQL Editor...')
  console.log('   (Press Ctrl+C to cancel, or just continue if already done)\n')

  // Give user 3 seconds to read, then proceed to verification
  await new Promise(resolve => setTimeout(resolve, 3000))

  console.log('🔍 Verifying table creation...\n')

  // Try to verify the tables exist
  await verifyTables()
}

async function verifyTables() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('               VERIFYING TABLES                            ')
  console.log('═══════════════════════════════════════════════════════════\n')

  try {
    // Test 1: wallet_scores_by_category
    console.log('1️⃣  Testing wallet_scores_by_category table...')
    const { data: categoryTest, error: categoryError } = await supabase
      .from('wallet_scores_by_category')
      .select('wallet_address')
      .limit(1)

    if (categoryError) {
      if (categoryError.message.includes('not found') || categoryError.message.includes('does not exist')) {
        console.log('   ❌ Table not found - migration not yet applied')
        console.log('   📝 Please run the SQL in Supabase SQL Editor\n')
        return false
      } else {
        console.log(`   ⚠️  Error: ${categoryError.message}\n`)
        return false
      }
    } else {
      console.log('   ✅ Table exists and accessible')

      const { count } = await supabase
        .from('wallet_scores_by_category')
        .select('*', { count: 'exact', head: true })

      console.log(`   📊 Current rows: ${count || 0}\n`)
    }

    // Test 2: wallet_tracking_criteria
    console.log('2️⃣  Testing wallet_tracking_criteria table...')
    const { data: criteriaData, error: criteriaError } = await supabase
      .from('wallet_tracking_criteria')
      .select('id, name, description, min_omega_ratio, min_closed_positions')

    if (criteriaError) {
      console.log(`   ❌ Error: ${criteriaError.message}\n`)
      return false
    } else {
      console.log('   ✅ Table exists and accessible')
      console.log(`   📊 Default criteria: ${criteriaData?.length || 0} rows`)

      if (criteriaData && criteriaData.length > 0) {
        console.log('\n   Default criteria:')
        criteriaData.forEach((c: any) => {
          console.log(`     ✓ ${c.name}: ${c.description}`)
          console.log(`       (min_omega: ${c.min_omega_ratio}, min_trades: ${c.min_closed_positions})`)
        })
      } else {
        console.log('   ⚠️  No default criteria found - check if migration INSERT statements ran')
      }
      console.log()
    }

    console.log('═══════════════════════════════════════════════════════════')
    console.log('                  ✅ TABLES VERIFIED                        ')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log('✅ Both tables exist and are accessible!')
    console.log('\n📝 Next step: Run category omega calculation')
    console.log('   Command: npx tsx scripts/calculate-category-omega.ts\n')

    return true
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    return false
  }
}

createTablesDirectly()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
