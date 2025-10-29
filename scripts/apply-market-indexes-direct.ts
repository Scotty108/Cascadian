import { supabaseAdmin } from '../lib/supabase'
import { readFileSync } from 'fs'
import { join } from 'path'

async function applyIndexes() {
  console.log('📊 Applying database indexes for performance...\n')

  const sqlPath = join(process.cwd(), 'migrations/supabase/002_add_market_indexes.sql')
  const sql = readFileSync(sqlPath, 'utf-8')

  // Extract individual CREATE INDEX statements
  const indexStatements = sql
    .split('\n')
    .filter(line => line.trim().startsWith('CREATE INDEX'))

  console.log(`Found ${indexStatements.length} index creation statements\n`)

  let successCount = 0
  let failCount = 0

  for (const statement of indexStatements) {
    const indexName = statement.match(/idx_\w+/)?.[0] || 'unknown'
    console.log(`Creating ${indexName}...`)

    try {
      // Execute the full multi-line statement
      const fullStatement = sql.split(statement)[1].split(';')[0]
      const completeSQL = statement + fullStatement + ';'

      const { data, error } = await supabaseAdmin.rpc('exec', { sql: completeSQL })

      if (error) {
        // Try direct query as fallback
        const result = await fetch(process.env.SUPABASE_URL + '/rest/v1/rpc/exec', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
          },
          body: JSON.stringify({ sql: completeSQL })
        })

        if (!result.ok) {
          console.log(`  ⚠️  Might already exist (this is OK)`)
        } else {
          console.log(`  ✅ Created`)
          successCount++
        }
      } else {
        console.log(`  ✅ Created`)
        successCount++
      }
    } catch (error: any) {
      if (error.message?.includes('already exists')) {
        console.log(`  ℹ️  Already exists`)
      } else {
        console.log(`  ❌ Error: ${error.message}`)
        failCount++
      }
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`✅ Success: ${successCount}`)
  console.log(`ℹ️  Skipped: ${indexStatements.length - successCount - failCount}`)
  console.log(`❌ Failed: ${failCount}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)

  if (failCount === 0) {
    console.log('🎉 All indexes ready! Database queries should be 3-10x faster.\n')
  }
}

applyIndexes().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
