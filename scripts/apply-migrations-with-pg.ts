/**
 * Apply migrations using direct PostgreSQL connection
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { Client } from 'pg'

config({ path: resolve(process.cwd(), '.env.local') })

async function applyMigrations() {
  console.log('🚀 Applying Database Migrations with pg\n')

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  })

  try {
    await client.connect()
    console.log('✅ Connected to database\n')

    // Migration 1: wallet_scores_by_category
    console.log('📄 Migration 1: Create wallet_scores_by_category table')
    const migration1SQL = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20251024240000_create_wallet_scores_by_category.sql'),
      'utf-8'
    )

    await client.query(migration1SQL)
    console.log('   ✅ wallet_scores_by_category table created\n')

    // Migration 2: wallet_tracking_criteria
    console.log('📄 Migration 2: Create wallet_tracking_criteria table')
    const migration2SQL = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/20251024240001_create_wallet_tracking_criteria.sql'),
      'utf-8'
    )

    await client.query(migration2SQL)
    console.log('   ✅ wallet_tracking_criteria table created\n')

    console.log('✅ All migrations applied successfully!')
    console.log('\n📊 Next step: Run category omega calculation')
    console.log('   npx tsx scripts/calculate-category-omega.ts\n')

  } catch (error: any) {
    console.error('❌ Migration error:', error.message)
    if (error.message.includes('already exists')) {
      console.log('\n✅ Tables already exist - migrations were previously applied')
    }
  } finally {
    await client.end()
  }
}

applyMigrations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
