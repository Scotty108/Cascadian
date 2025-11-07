#!/usr/bin/env npx tsx

/**
 * DIAGNOSTIC: Wallet Gap Investigation
 *
 * Systematically test three hypotheses for why Wallets 2-4 have zero resolved condition data:
 * H1 (95%): market_resolutions_final table incomplete
 * H2 (85%): condition_id field in trades_raw not populated
 * H3 (70%): Wallets 2-4 data never imported to trades_raw
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const WALLETS = [
  { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', name: 'Wallet 1 (CONTROL)' },
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', name: 'Wallet 2' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', name: 'Wallet 3' },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', name: 'Wallet 4' },
]

async function execute() {
  console.log('='.repeat(100))
  console.log('DIAGNOSTIC: Wallet Gap Investigation')
  console.log('Testing 3 hypotheses for Wallets 2-4 zero P&L')
  console.log('='.repeat(100))

  try {
    const walletList = WALLETS.map(w => `'${w.addr.toLowerCase()}'`).join(',')

    // CHECK 1: Table existence
    console.log('\n[CHECK 1] Table Status')
    const tables = await (await clickhouse.query({
      query: `
        SELECT
          name,
          total_rows,
          total_bytes
        FROM system.tables
        WHERE name IN ('trades_raw', 'market_resolutions_final')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`  ✅ Found ${tables.length} tables:`)
    for (const t of tables) {
      console.log(`     - ${t.name}: ${t.total_rows} rows`)
    }

    // CHECK 2: Data volume per wallet
    console.log('\n[CHECK 2] Trade Volume Per Wallet')
    const tradeVolume = await (await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          count() as total_trades,
          countIf(condition_id != '') as condition_id_populated,
          countIf(condition_id = '') as condition_id_empty,
          round(100.0 * countIf(condition_id != '') / count(*), 1) as pct_populated
        FROM trades_raw
        WHERE wallet_address IN (${walletList})
        GROUP BY wallet_address
        ORDER BY total_trades DESC
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n  Trade counts:')
    for (const row of tradeVolume) {
      const name = WALLETS.find(w => w.addr.toLowerCase() === row.wallet_address.toLowerCase())?.name
      console.log(`    ${name}: ${row.total_trades} trades (${row.condition_id_populated} with condition_id, ${row.pct_populated}%)`)
    }

    // CHECK 3: JOIN verification (critical)
    console.log('\n[CHECK 3] JOIN Verification (Trades → Resolutions)')
    const joinTest = await (await clickhouse.query({
      query: `
        SELECT
          t.wallet_address,
          count(*) as total_trade_rows,
          countIf(r.condition_id_norm IS NOT NULL) as matched_to_resolution,
          countIf(r.condition_id_norm IS NULL) as unmatched,
          round(100.0 * countIf(r.condition_id_norm IS NOT NULL) / count(*), 1) as match_pct,
          countIf(r.winning_index IS NOT NULL) as has_winning_index,
          countIf(r.winning_index IS NULL) as no_winning_index
        FROM trades_raw t
        LEFT JOIN market_resolutions_final r ON
          lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        WHERE t.wallet_address IN (${walletList})
        GROUP BY t.wallet_address
        ORDER BY total_trade_rows DESC
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log('\n  Join results:')
    for (const row of joinTest) {
      const name = WALLETS.find(w => w.addr.toLowerCase() === row.wallet_address.toLowerCase())?.name
      console.log(`    ${name}:`)
      console.log(`      - Matched to resolution: ${row.matched_to_resolution}/${row.total_trade_rows} (${row.match_pct}%)`)
      console.log(`      - With winning_index (RESOLVED): ${row.has_winning_index}`)
      console.log(`      - Without winning_index (UNRESOLVED): ${row.no_winning_index}`)
    }

    // CHECK 4: Sample condition ID analysis
    console.log('\n[CHECK 4] Sample Condition IDs and JOIN Results')
    console.log('  Wallet 2 samples:')
    const samples = await (await clickhouse.query({
      query: `
        SELECT
          t.condition_id,
          lower(replaceAll(t.condition_id, '0x', '')) as normalized,
          r.condition_id_norm,
          IF(r.condition_id_norm IS NOT NULL, 'MATCHED', 'NOT_FOUND') as join_status,
          r.winning_index,
          r.winning_outcome
        FROM trades_raw t
        LEFT JOIN market_resolutions_final r ON
          lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
        WHERE t.wallet_address = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    for (const s of samples) {
      console.log(`    condition_id: ${s.condition_id?.substring(0, 16)}...`)
      console.log(`      normalized: ${s.normalized?.substring(0, 16)}...`)
      console.log(`      join_status: ${s.join_status}`)
      if (s.join_status === 'MATCHED') {
        console.log(`      winning_index: ${s.winning_index} (outcome: ${s.winning_outcome})`)
      }
    }

    // CHECK 5: Market resolution data status
    console.log('\n[CHECK 5] Market Resolutions Table Status')
    const resStatus = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          countIf(winning_index IS NOT NULL) as resolved_count,
          countIf(winning_index IS NULL) as unresolved_count,
          COUNT(DISTINCT condition_id_norm) as unique_conditions
        FROM market_resolutions_final
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const rs = resStatus[0]
    console.log(`  Total rows: ${rs.total_rows}`)
    console.log(`  Resolved (winning_index IS NOT NULL): ${rs.resolved_count}`)
    console.log(`  Unresolved: ${rs.unresolved_count}`)
    console.log(`  Unique conditions: ${rs.unique_conditions}`)

    // DIAGNOSIS
    console.log('\n' + '='.repeat(100))
    console.log('DIAGNOSIS')
    console.log('='.repeat(100))

    const wallet2Data = joinTest.find(r => r.wallet_address.toLowerCase() === '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'.toLowerCase())
    const wallet1Data = joinTest.find(r => r.wallet_address.toLowerCase() === '0x1489046ca0f9980fc2d9a950d103d3bec02c1307'.toLowerCase())

    console.log('\n📊 FINDINGS:')

    if (wallet1Data && wallet1Data.matched_to_resolution > 0) {
      console.log(`\n✅ WALLET 1 (Control): ${wallet1Data.matched_to_resolution} conditions matched (${wallet1Data.match_pct}%)`)
      console.log(`   → Resolved (has winning_index): ${wallet1Data.has_winning_index}`)
    } else {
      console.log(`\n❌ WALLET 1 (Control): No matched conditions - JOIN is broken!`)
    }

    if (wallet2Data && wallet2Data.matched_to_resolution === 0 && wallet2Data.total_trade_rows > 0) {
      console.log(`\n❌ WALLET 2: ${wallet2Data.total_trade_rows} trades but 0 matched to resolutions`)
      console.log(`   → This is HYPOTHESIS 3 (wallets 2-4 never imported) or data corruption`)

      // Check if condition_ids are even populated
      const w2Volume = tradeVolume.find(r => r.wallet_address.toLowerCase() === wallet2Data.wallet_address.toLowerCase())
      if (w2Volume && w2Volume.condition_id_populated === 0) {
        console.log(`\n   → HYPOTHESIS 2 CONFIRMED: condition_id field is EMPTY`)
        console.log(`      Fix: Backfill condition_id field (30 min)`)
      } else if (w2Volume && w2Volume.condition_id_populated > 0) {
        console.log(`\n   → HYPOTHESIS 1/3: condition_id is populated but doesn't match resolutions`)
        console.log(`      Possible: condition_ids mismatch between trades_raw and market_resolutions`)
        console.log(`      Fix: Verify condition_id format/normalization (investigate further)`)
      }
    } else if (wallet2Data && wallet2Data.matched_to_resolution > 0 && wallet2Data.has_winning_index === 0) {
      console.log(`\n⚠️  WALLET 2: ${wallet2Data.matched_to_resolution} conditions matched, but 0 are RESOLVED`)
      console.log(`   → Markets haven't resolved yet (expected for some markets)`)
      console.log(`   → P&L = $0 is correct if no markets resolved`)
    }

    console.log('\n' + '='.repeat(100))
    console.log('RECOMMENDATION')
    console.log('='.repeat(100))

    if (wallet1Data && wallet1Data.has_winning_index > 100) {
      console.log('\n✅ Formula is working correctly for Wallet 1')
      console.log('   Wallets 2-4 likely have unresolved/unfilled markets')
      console.log('   P&L = $0 may be correct for these wallets')
      console.log('\n   NEXT STEP: Apply Type-Casting Fix (Option 1) to be safe')
      console.log('             Then validate all 4 wallets with corrected queries')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
