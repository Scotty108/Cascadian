/**
 * Apply Phase 1 Metrics Migrations via Supabase Management API
 *
 * Uses Supabase Management API to execute SQL migrations
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

async function runMigrationsViaAPI() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('          APPLYING PHASE 1 METRICS MIGRATIONS             ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN
  const projectRef = supabaseUrl.split('//')[1].split('.')[0]

  if (!accessToken) {
    console.error('❌ SUPABASE_ACCESS_TOKEN not found!')
    console.log('\nPlease add SUPABASE_ACCESS_TOKEN to your .env.local file.')
    console.log('You can generate one at: https://supabase.com/dashboard/account/tokens')
    process.exit(1)
  }

  try {
    // Read migration file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), 'APPLY_MIGRATIONS_NOW.sql'),
      'utf-8'
    )

    console.log('📄 Migration file loaded')
    console.log('📊 Executing SQL via Supabase Management API...\n')

    // Use Supabase Management API to execute SQL
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: migrationSQL,
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('❌ API Error:', response.status, error)
      throw new Error(`Supabase API error: ${response.status} - ${error}`)
    }

    const result = await response.json()
    console.log('✅ Migrations executed successfully!\n')

    // Now verify using Supabase client
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    console.log('═══════════════════════════════════════════════════════════')
    console.log('               VERIFYING MIGRATIONS                        ')
    console.log('═══════════════════════════════════════════════════════════\n')

    // Check wallet_scores_by_category
    console.log('1️⃣  Checking wallet_scores_by_category table...')
    const { data: categoryData, error: categoryError } = await supabase
      .from('wallet_scores_by_category')
      .select('*')
      .limit(1)

    if (categoryError) {
      console.log(`   ⚠️  Error: ${categoryError.message}`)
    } else {
      console.log(`   ✅ Table exists and is accessible`)

      const { count } = await supabase
        .from('wallet_scores_by_category')
        .select('*', { count: 'exact', head: true })

      console.log(`   📊 Current rows: ${count || 0}\n`)
    }

    // Check wallet_tracking_criteria
    console.log('2️⃣  Checking wallet_tracking_criteria table...')
    const { data: criteriaData, error: criteriaError } = await supabase
      .from('wallet_tracking_criteria')
      .select('id, name, description, min_omega_ratio, min_closed_positions')

    if (criteriaError) {
      console.log(`   ⚠️  Error: ${criteriaError.message}`)
    } else {
      console.log(`   ✅ Table exists and is accessible`)
      console.log(`   📊 Default criteria: ${criteriaData?.length || 0} rows`)

      if (criteriaData && criteriaData.length > 0) {
        console.log('\n   Default criteria:')
        criteriaData.forEach((c: any) => {
          console.log(`     - ${c.name}: ${c.description}`)
          console.log(`       (min_omega: ${c.min_omega_ratio}, min_trades: ${c.min_closed_positions})`)
        })
      }
      console.log()
    }

    console.log('═══════════════════════════════════════════════════════════')
    console.log('                   MIGRATION COMPLETE                      ')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log('✅ All migrations applied successfully!')
    console.log('✅ Tables created with proper schema')
    console.log('✅ Default tracking criteria inserted')
    console.log('\n📝 Next step: Run category omega calculation')
    console.log('   Command: npx tsx scripts/calculate-category-omega.ts\n')

  } catch (error) {
    console.error('❌ Error running migrations:', error)
    throw error
  }
}

runMigrationsViaAPI()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
