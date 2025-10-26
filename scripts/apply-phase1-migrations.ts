/**
 * Apply Phase 1 Metrics Migrations to Supabase
 *
 * Creates:
 * - wallet_scores_by_category table
 * - wallet_tracking_criteria table
 * - Indexes and triggers
 * - Default tracking criteria
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
  console.log('═══════════════════════════════════════════════════════════')
  console.log('          APPLYING PHASE 1 METRICS MIGRATIONS             ')
  console.log('═══════════════════════════════════════════════════════════\n')

  try {
    // Read the migration file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), 'APPLY_MIGRATIONS_NOW.sql'),
      'utf-8'
    )

    console.log('📄 Migration file loaded successfully')
    console.log('📊 Executing SQL statements...\n')

    // Split into individual statements and execute
    // Note: We'll execute the entire migration as one block since it has IF NOT EXISTS checks
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL })

    if (error) {
      // If rpc method doesn't exist, we'll need to use direct SQL execution
      console.log('⚠️  RPC method not available, using direct execution...\n')

      // For direct execution, we need to split the statements carefully
      // Let's execute each major section separately
      const sections = [
        // Section 1: wallet_scores_by_category table
        migrationSQL.substring(
          migrationSQL.indexOf('CREATE TABLE IF NOT EXISTS wallet_scores_by_category'),
          migrationSQL.indexOf('-- Migration 2: wallet_tracking_criteria')
        ),
        // Section 2: wallet_tracking_criteria table
        migrationSQL.substring(
          migrationSQL.indexOf('CREATE TABLE IF NOT EXISTS wallet_tracking_criteria'),
          migrationSQL.indexOf('-- ============================================================================\n-- VERIFICATION QUERIES')
        ),
      ]

      for (let i = 0; i < sections.length; i++) {
        console.log(`📝 Executing section ${i + 1}/${sections.length}...`)
        const section = sections[i].trim()

        if (section) {
          // We can't execute raw SQL directly through Supabase client
          // User will need to run this in Supabase SQL Editor
          console.log(`\n⚠️  Cannot execute raw SQL programmatically.`)
          console.log(`\nPlease run the migration manually in Supabase SQL Editor:`)
          console.log(`https://supabase.com/dashboard/project/${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('.')[0].split('//')[1]}/sql\n`)
          console.log(`Migration file location: /Users/scotty/Projects/Cascadian-app/APPLY_MIGRATIONS_NOW.sql\n`)

          // Let's try to verify if tables already exist instead
          console.log('🔍 Checking if tables already exist...\n')
          await verifyMigrations()
          return
        }
      }
    } else {
      console.log('✅ Migrations executed successfully!\n')
    }

    // Verify the migrations
    await verifyMigrations()

  } catch (error) {
    console.error('❌ Error applying migrations:', error)
    throw error
  }
}

async function verifyMigrations() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('               VERIFYING MIGRATIONS                        ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Check wallet_scores_by_category table
  console.log('1️⃣  Checking wallet_scores_by_category table...')
  const { data: categoryColumns, error: categoryError } = await supabase
    .from('wallet_scores_by_category')
    .select('*')
    .limit(0)

  if (categoryError) {
    console.log(`   ❌ Table does not exist or error: ${categoryError.message}`)
    console.log(`   📝 This table needs to be created with the migration\n`)
  } else {
    console.log(`   ✅ Table exists`)

    // Count rows
    const { count, error: countError } = await supabase
      .from('wallet_scores_by_category')
      .select('*', { count: 'exact', head: true })

    if (!countError) {
      console.log(`   📊 Current rows: ${count}\n`)
    }
  }

  // Check wallet_tracking_criteria table
  console.log('2️⃣  Checking wallet_tracking_criteria table...')
  const { data: criteriaData, error: criteriaError } = await supabase
    .from('wallet_tracking_criteria')
    .select('id, name, description')

  if (criteriaError) {
    console.log(`   ❌ Table does not exist or error: ${criteriaError.message}`)
    console.log(`   📝 This table needs to be created with the migration\n`)
  } else {
    console.log(`   ✅ Table exists`)
    console.log(`   📊 Default criteria count: ${criteriaData?.length || 0}`)

    if (criteriaData && criteriaData.length > 0) {
      console.log('\n   Default criteria:')
      criteriaData.forEach((c) => {
        console.log(`     - ${c.name}: ${c.description}`)
      })
    }
    console.log()
  }

  // Check indexes
  console.log('3️⃣  Checking indexes...')
  const { data: indexes, error: indexError } = await supabase
    .from('pg_indexes')
    .select('indexname, tablename')
    .or('tablename.eq.wallet_scores_by_category,tablename.eq.wallet_tracking_criteria')

  if (indexError) {
    console.log(`   ⚠️  Could not verify indexes: ${indexError.message}\n`)
  } else if (indexes && indexes.length > 0) {
    console.log(`   ✅ Found ${indexes.length} indexes:`)
    indexes.forEach((idx) => {
      console.log(`     - ${idx.indexname} on ${idx.tablename}`)
    })
    console.log()
  }

  console.log('═══════════════════════════════════════════════════════════\n')
}

applyMigrations()
  .then(() => {
    console.log('✅ Migration process complete!\n')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  })
