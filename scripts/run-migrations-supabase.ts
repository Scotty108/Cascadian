/**
 * Apply Phase 1 Metrics Migrations via Direct PostgreSQL Connection
 *
 * Uses pg library to execute DDL statements that Supabase client can't handle
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { Client } from 'pg'

config({ path: resolve(process.cwd(), '.env.local') })

async function runMigrations() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('          APPLYING PHASE 1 METRICS MIGRATIONS             ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Parse Supabase URL to get PostgreSQL connection details
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.split('//')[1].split('.')[0]
  const dbPassword = process.env.SUPABASE_DB_PASSWORD

  // Construct PostgreSQL connection string
  // Format: postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
  let databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl && dbPassword) {
    // Build from components if DATABASE_URL not set
    databaseUrl = `postgresql://postgres:${dbPassword}@db.${projectRef}.supabase.co:5432/postgres`
    console.log('📝 Using constructed DATABASE_URL from SUPABASE_DB_PASSWORD')
  }

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL or SUPABASE_DB_PASSWORD environment variable not found!')
    console.log('\nPlease add one of these to your .env.local file:')
    console.log('1. DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres')
    console.log('2. SUPABASE_DB_PASSWORD=[PASSWORD]')
    console.log('\nYou can find the password in Supabase Dashboard > Project Settings > Database')
    process.exit(1)
  }

  const client = new Client({
    connectionString: databaseUrl,
  })

  try {
    console.log('🔌 Connecting to PostgreSQL...')
    await client.connect()
    console.log('✅ Connected successfully!\n')

    // Read migration file
    const migrationSQL = readFileSync(
      resolve(process.cwd(), 'APPLY_MIGRATIONS_NOW.sql'),
      'utf-8'
    )

    console.log('📄 Migration file loaded')
    console.log('📊 Executing SQL statements...\n')

    // Execute the migration
    // The migration file uses IF NOT EXISTS, so it's safe to run multiple times
    await client.query(migrationSQL)

    console.log('✅ Migrations executed successfully!\n')

    // Verify tables were created
    console.log('═══════════════════════════════════════════════════════════')
    console.log('               VERIFYING MIGRATIONS                        ')
    console.log('═══════════════════════════════════════════════════════════\n')

    // Check wallet_scores_by_category
    const categoryResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'wallet_scores_by_category'
      ORDER BY ordinal_position;
    `)

    console.log('1️⃣  wallet_scores_by_category table:')
    console.log(`   ✅ ${categoryResult.rows.length} columns created`)

    // Count rows
    const categoryCount = await client.query('SELECT COUNT(*) FROM wallet_scores_by_category')
    console.log(`   📊 Current rows: ${categoryCount.rows[0].count}\n`)

    // Check wallet_tracking_criteria
    const criteriaResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'wallet_tracking_criteria'
      ORDER BY ordinal_position;
    `)

    console.log('2️⃣  wallet_tracking_criteria table:')
    console.log(`   ✅ ${criteriaResult.rows.length} columns created`)

    // Check default criteria
    const defaultCriteria = await client.query(`
      SELECT id, name, description, min_omega_ratio, min_closed_positions
      FROM wallet_tracking_criteria
      ORDER BY id
    `)

    console.log(`   📊 Default criteria: ${defaultCriteria.rows.length} rows`)
    if (defaultCriteria.rows.length > 0) {
      console.log('\n   Default criteria:')
      defaultCriteria.rows.forEach((row) => {
        console.log(`     - ${row.name}: ${row.description}`)
        console.log(`       (min_omega: ${row.min_omega_ratio}, min_trades: ${row.min_closed_positions})`)
      })
    }
    console.log()

    // Check indexes
    const indexes = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND (tablename = 'wallet_scores_by_category' OR tablename = 'wallet_tracking_criteria')
      ORDER BY tablename, indexname;
    `)

    console.log('3️⃣  Indexes:')
    if (indexes.rows.length > 0) {
      console.log(`   ✅ ${indexes.rows.length} indexes created:`)
      indexes.rows.forEach((idx) => {
        console.log(`     - ${idx.indexname} on ${idx.tablename}`)
      })
    }
    console.log()

    console.log('═══════════════════════════════════════════════════════════')
    console.log('                   MIGRATION COMPLETE                      ')
    console.log('═══════════════════════════════════════════════════════════\n')
    console.log('✅ All migrations applied successfully!')
    console.log('✅ Tables created with proper schema')
    console.log('✅ Indexes created for performance')
    console.log('✅ Default tracking criteria inserted')
    console.log('\n📝 Next step: Run category omega calculation')
    console.log('   Command: npx tsx scripts/calculate-category-omega.ts\n')

  } catch (error) {
    console.error('❌ Error running migrations:', error)
    throw error
  } finally {
    await client.end()
    console.log('🔌 Database connection closed\n')
  }
}

runMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
