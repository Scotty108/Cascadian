/**
 * Apply Market Indexes Migration
 *
 * Adds performance indexes to markets and market_analytics tables
 * Expected improvement: 3-5x faster queries
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function applyIndexes() {
  console.log('🗂️  Applying market indexes migration...\n')

  try {
    // Read migration file
    const migrationPath = resolve(process.cwd(), 'migrations/supabase/002_add_market_indexes.sql')
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8')

    // Split into individual statements (skip comments and empty lines)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'))

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`)

    let successCount = 0
    let errorCount = 0

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]

      // Extract index name for logging
      const indexNameMatch = statement.match(/idx_\w+/)
      const indexName = indexNameMatch ? indexNameMatch[0] : `Statement ${i + 1}`

      try {
        console.log(`[${i + 1}/${statements.length}] Creating ${indexName}...`)

        // Use fetch to execute raw SQL via PostgREST
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            },
            body: JSON.stringify({ query: statement + ';' })
          }
        )

        if (!response.ok) {
          const error = await response.text()
          // Check if index already exists (not a critical error)
          if (error.includes('already exists') || error.includes('duplicate')) {
            console.log(`   ⚠️  ${indexName} already exists (skipping)`)
          } else {
            console.error(`   ❌ Failed: ${error}`)
            errorCount++
          }
        } else {
          console.log(`   ✅ Created successfully`)
          successCount++
        }
      } catch (err) {
        console.error(`   ❌ Exception: ${err}`)
        errorCount++
      }
    }

    console.log('\n' + '='.repeat(60))
    console.log(`✅ Migration complete!`)
    console.log(`   Success: ${successCount}`)
    console.log(`   Errors: ${errorCount}`)
    console.log('='.repeat(60))

    // Verify indexes were created
    console.log('\n📊 Verifying indexes...')
    const { data: indexes, error: verifyError } = await supabase
      .from('pg_indexes')
      .select('tablename, indexname')
      .in('tablename', ['markets', 'market_analytics'])
      .like('indexname', 'idx_%')

    if (verifyError) {
      console.error('⚠️  Could not verify indexes:', verifyError.message)
    } else if (indexes) {
      console.log(`✅ Found ${indexes.length} indexes:`)
      indexes.forEach(idx => {
        console.log(`   - ${idx.tablename}.${idx.indexname}`)
      })
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  }
}

// Execute
applyIndexes().catch(console.error)
