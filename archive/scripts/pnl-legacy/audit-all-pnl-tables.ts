#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

// Target wallets with expected P&L values
const TARGET_WALLETS = [
  { name: 'niggemon', address: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', expected: 102001.46 },
  { name: 'HolyMoses7', address: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', expected: 89975.16 },
  { name: 'LucasMeow', address: '0x7f3c8979d0afa00007bae4747d5347122af05613', expected: 179243 },
  { name: 'xcnstrategy', address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', expected: 94730 }
]

interface TableInfo {
  name: string
  engine: string
  total_rows: number
  total_bytes: number
}

interface PnLResult {
  table: string
  wallet: string
  pnl_value: number | null
  column_name: string
  row_count: number
  match_percent: number
}

async function getAllTables(): Promise<TableInfo[]> {
  console.log('📊 Discovering all tables in database...\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database = 'default'
        AND name NOT LIKE '.%'
      ORDER BY name
    `,
    format: 'JSONEachRow'
  })

  return await result.json() as TableInfo[]
}

async function getTableColumns(tableName: string): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT name
      FROM system.columns
      WHERE database = 'default'
        AND table = '${tableName}'
        AND (
          name ILIKE '%pnl%'
          OR name ILIKE '%profit%'
          OR name ILIKE '%loss%'
          OR name ILIKE '%return%'
          OR name ILIKE '%value%'
          OR name ILIKE '%usd%'
        )
      ORDER BY name
    `,
    format: 'JSONEachRow'
  })

  const cols = await result.json() as { name: string }[]
  return cols.map(c => c.name)
}

async function queryWalletPnL(
  tableName: string,
  walletAddress: string,
  pnlColumns: string[]
): Promise<{ column: string; value: number | null; rows: number }[]> {
  const results: { column: string; value: number | null; rows: number }[] = []

  // Try different wallet column name variations
  const walletColumnVariations = [
    'wallet_address',
    'wallet',
    'address',
    'user_address',
    'trader_address'
  ]

  for (const walletCol of walletColumnVariations) {
    try {
      // Check if this wallet column exists
      const checkCol = await clickhouse.query({
        query: `SELECT name FROM system.columns WHERE database = 'default' AND table = '${tableName}' AND name = '${walletCol}'`,
        format: 'JSONEachRow'
      })
      const colExists = (await checkCol.json() as any[]).length > 0

      if (!colExists) continue

      // Query each PnL column
      for (const pnlCol of pnlColumns) {
        try {
          const query = `
            SELECT
              SUM(${pnlCol}) as total_pnl,
              COUNT(*) as row_count
            FROM ${tableName}
            WHERE lower(${walletCol}) = lower('${walletAddress}')
              AND ${pnlCol} IS NOT NULL
              AND ${pnlCol} != 0
          `

          const result = await clickhouse.query({ query, format: 'JSONEachRow' })
          const data = await result.json() as any[]

          if (data.length > 0 && data[0].row_count > 0) {
            results.push({
              column: pnlCol,
              value: parseFloat(data[0].total_pnl) || null,
              rows: parseInt(data[0].row_count) || 0
            })
          }
        } catch (err: any) {
          // Column might not be numeric or query failed
          if (!err.message.includes('does not exist') && !err.message.includes('type mismatch')) {
            console.log(`  ⚠️  Error querying ${tableName}.${pnlCol}: ${err.message}`)
          }
        }
      }

      // If we found results, don't try other wallet column variations
      if (results.length > 0) break

    } catch (err) {
      // This wallet column doesn't exist, try next one
      continue
    }
  }

  return results
}

function calculateMatchPercent(actual: number, expected: number): number {
  if (expected === 0) return 0
  return (actual / expected) * 100
}

async function main() {
  console.log('🔍 COMPREHENSIVE P&L TABLE AUDIT')
  console.log('=' .repeat(80))
  console.log('\nTarget wallets:')
  TARGET_WALLETS.forEach(w => {
    console.log(`  ${w.name.padEnd(15)} ${w.address}  Expected: $${w.expected.toLocaleString()}`)
  })
  console.log('\n')

  // Get all tables
  const allTables = await getAllTables()
  console.log(`Found ${allTables.length} tables in database\n`)

  // Filter to tables that might have P&L data
  const candidateTables = allTables.filter(t =>
    t.name.includes('trade') ||
    t.name.includes('pnl') ||
    t.name.includes('wallet') ||
    t.name.includes('portfolio') ||
    t.name.includes('position') ||
    t.name.includes('realized') ||
    t.total_rows > 0
  )

  console.log(`Examining ${candidateTables.length} candidate tables...\n`)
  console.log('=' .repeat(80))
  console.log('\n')

  const allResults: PnLResult[] = []

  for (const table of candidateTables) {
    console.log(`\n📋 Table: ${table.name}`)
    console.log(`   Engine: ${table.engine}, Rows: ${table.total_rows?.toLocaleString() || '0'}`)

    // Get P&L columns
    const pnlColumns = await getTableColumns(table.name)

    if (pnlColumns.length === 0) {
      console.log(`   ⏭️  No P&L columns found, skipping`)
      continue
    }

    console.log(`   P&L columns: ${pnlColumns.join(', ')}`)

    // Query each target wallet
    for (const wallet of TARGET_WALLETS) {
      const results = await queryWalletPnL(table.name, wallet.address, pnlColumns)

      if (results.length > 0) {
        console.log(`   \n   💰 ${wallet.name}:`)
        results.forEach(r => {
          const matchPct = calculateMatchPercent(r.value || 0, wallet.expected)
          const matchEmoji = matchPct >= 50 ? '✅' : matchPct >= 25 ? '⚠️' : '❌'
          console.log(`      ${matchEmoji} ${r.column}: $${(r.value || 0).toLocaleString()} (${matchPct.toFixed(1)}% of expected, ${r.rows} rows)`)

          allResults.push({
            table: table.name,
            wallet: wallet.name,
            pnl_value: r.value,
            column_name: r.column,
            row_count: r.rows,
            match_percent: matchPct
          })
        })
      }
    }
  }

  // Summary report
  console.log('\n\n')
  console.log('=' .repeat(80))
  console.log('📊 SUMMARY REPORT')
  console.log('=' .repeat(80))
  console.log('\n')

  if (allResults.length === 0) {
    console.log('❌ NO P&L DATA FOUND FOR ANY TARGET WALLET IN ANY TABLE')
    return
  }

  // Group by wallet
  for (const wallet of TARGET_WALLETS) {
    console.log(`\n${wallet.name} (Expected: $${wallet.expected?.toLocaleString() || 'N/A'})`)
    console.log('-'.repeat(80))

    const walletResults = allResults.filter(r => r.wallet === wallet.name)

    if (walletResults.length === 0) {
      console.log('  ❌ NO DATA FOUND IN ANY TABLE')
      continue
    }

    // Sort by match percentage
    walletResults.sort((a, b) => b.match_percent - a.match_percent)

    console.log('  TABLE | COLUMN | VALUE | MATCH% | ROWS')
    console.log('  ' + '-'.repeat(76))

    walletResults.forEach(r => {
      const matchEmoji = r.match_percent >= 50 ? '✅' : r.match_percent >= 25 ? '⚠️' : '❌'
      console.log(`  ${matchEmoji} ${r.table.padEnd(30)} | ${r.column_name.padEnd(20)} | $${(r.pnl_value || 0).toFixed(2).padStart(12)} | ${r.match_percent.toFixed(1).padStart(5)}% | ${r.row_count.toString().padStart(6)}`)
    })

    // Best match
    const bestMatch = walletResults[0]
    console.log(`\n  🏆 BEST MATCH: ${bestMatch.table}.${bestMatch.column_name} = $${(bestMatch.pnl_value || 0).toLocaleString()} (${bestMatch.match_percent.toFixed(1)}% of expected)`)
  }

  // Final recommendation
  console.log('\n\n')
  console.log('=' .repeat(80))
  console.log('🎯 RECOMMENDATION')
  console.log('=' .repeat(80))
  console.log('\n')

  // Find table with best overall matches
  const tableScores = new Map<string, { score: number; matches: number }>()

  allResults.forEach(r => {
    const current = tableScores.get(r.table) || { score: 0, matches: 0 }
    tableScores.set(r.table, {
      score: current.score + r.match_percent,
      matches: current.matches + 1
    })
  })

  const sortedTables = Array.from(tableScores.entries())
    .map(([table, data]) => ({
      table,
      avgScore: data.score / data.matches,
      matches: data.matches
    }))
    .sort((a, b) => b.avgScore - a.avgScore)

  if (sortedTables.length > 0) {
    const best = sortedTables[0]
    console.log(`Best table: ${best.table}`)
    console.log(`  - Average match: ${best.avgScore.toFixed(1)}%`)
    console.log(`  - Wallet hits: ${best.matches}`)

    if (best.avgScore >= 50) {
      console.log(`\n✅ This table has values close to expected P&L targets`)
    } else {
      console.log(`\n⚠️  No table found with values matching expected targets (>50%)`)
      console.log(`    The expected values may be from a different source or calculation method`)
    }
  } else {
    console.log('❌ No P&L data found for any target wallet in any table')
  }

  console.log('\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
