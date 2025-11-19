#!/usr/bin/env npx tsx
/**
 * TRACE PHANTOM THROUGH PIPELINE
 * Trace phantom condition_id 03f1de7c... through each pipeline stage
 * to find where it gets associated with target wallet
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'
const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'

async function tracePipeline() {
  const client = getClickHouseClient()

  try {
    console.log('\n' + '='.repeat(80))
    console.log('TRACING PHANTOM THROUGH PIPELINE')
    console.log('='.repeat(80))
    console.log(`\nTarget wallet: ${TARGET_WALLET}`)
    console.log(`Phantom condition: ${PHANTOM_CONDITION}`)
    console.log(`\nThis condition_id appears in P&L but wallet never traded it.`)
    console.log(`Let's trace where it comes from...\n`)

    // STAGE 1: vw_clob_fills_enriched (source of truth for trades)
    console.log('=' .repeat(80))
    console.log('STAGE 1: vw_clob_fills_enriched (raw fills)')
    console.log('='.repeat(80) + '\n')

    const stage1Result = await client.query({
      query: `
        SELECT COUNT(*) as count
        FROM vw_clob_fills_enriched
        WHERE lower(replaceAll(\`cf.condition_id\`, '0x', '')) = '${PHANTOM_CONDITION}'
          AND (lower(user_eoa) = lower('${TARGET_WALLET}')
               OR lower(proxy_wallet) = lower('${TARGET_WALLET}'))
      `,
      format: 'JSONEachRow'
    })
    const stage1 = await stage1Result.json<any[]>()
    const stage1Count = parseInt(stage1[0].count)

    console.log(`Target wallet rows: ${stage1Count}`)
    if (stage1Count === 0) {
      console.log('✅ CORRECT - Wallet never traded this market\n')
    } else {
      console.log('❌ UNEXPECTED - Wallet has fills for this market!\n')
    }

    // Check if ANY wallet traded it
    const anyWalletResult = await client.query({
      query: `
        SELECT COUNT(*) as count
        FROM vw_clob_fills_enriched
        WHERE lower(replaceAll(\`cf.condition_id\`, '0x', '')) = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const anyWallet = await anyWalletResult.json<any[]>()
    console.log(`Other wallets traded it: ${parseInt(anyWallet[0].count)} fills total\n`)

    // STAGE 2: trade_cashflows_v3 (aggregated cost basis)
    console.log('=' .repeat(80))
    console.log('STAGE 2: trade_cashflows_v3 (cost basis)')
    console.log('='.repeat(80) + '\n')

    const stage2Result = await client.query({
      query: `
        SELECT
          wallet,
          condition_id_norm,
          cashflow_usdc
        FROM trade_cashflows_v3
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
          AND lower(wallet) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    })
    const stage2 = await stage2Result.json<any[]>()

    console.log(`Target wallet rows: ${stage2.length}`)
    if (stage2.length === 0) {
      console.log('✅ CORRECT - No cost basis for this market\n')
    } else {
      console.log('❌ PHANTOM APPEARS HERE - Has cost basis but no fills!')
      stage2.forEach((row: any, idx: number) => {
        console.log(`  ${idx + 1}. Cashflow: $${parseFloat(row.cashflow_usdc).toFixed(2)}`)
      })
      console.log('\n🔍 HYPOTHESIS: trade_cashflows_v3 is including fills from other wallets\n')
    }

    // Check how trade_cashflows_v3 is populated - any wallet
    const anyCashflowResult = await client.query({
      query: `
        SELECT COUNT(*) as count
        FROM trade_cashflows_v3
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const anyCashflow = await anyCashflowResult.json<any[]>()
    console.log(`Other wallets have cashflows: ${parseInt(anyCashflow[0].count)} total\n`)

    // STAGE 3: outcome_positions_v2 (net shares per outcome)
    console.log('=' .repeat(80))
    console.log('STAGE 3: outcome_positions_v2 (net positions)')
    console.log('='.repeat(80) + '\n')

    const stage3Result = await client.query({
      query: `
        SELECT
          wallet,
          condition_id_norm,
          outcome_idx,
          net_shares
        FROM outcome_positions_v2
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
          AND lower(wallet) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    })
    const stage3 = await stage3Result.json<any[]>()

    console.log(`Target wallet rows: ${stage3.length}`)
    if (stage3.length === 0) {
      console.log('✅ CORRECT - No positions for this market\n')
    } else {
      console.log('❌ PHANTOM APPEARS HERE - Has positions but no fills!')
      stage3.forEach((row: any, idx: number) => {
        console.log(`  ${idx + 1}. Outcome ${row.outcome_idx}: ${parseFloat(row.net_shares).toFixed(2)} shares`)
      })
      console.log('\n🔍 HYPOTHESIS: outcome_positions_v2 is including positions from other wallets\n')
    }

    // Check any wallet
    const anyPositionResult = await client.query({
      query: `
        SELECT COUNT(*) as count
        FROM outcome_positions_v2
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const anyPosition = await anyPositionResult.json<any[]>()
    console.log(`Other wallets have positions: ${parseInt(anyPosition[0].count)} total\n`)

    // STAGE 4: winning_index (resolved outcomes)
    console.log('=' .repeat(80))
    console.log('STAGE 4: winning_index (resolution data)')
    console.log('='.repeat(80) + '\n')

    const stage4Result = await client.query({
      query: `
        SELECT
          condition_id_norm,
          win_idx,
          resolved_at
        FROM winning_index
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
      `,
      format: 'JSONEachRow'
    })
    const stage4 = await stage4Result.json<any[]>()

    if (stage4.length > 0) {
      console.log(`Resolution found: YES`)
      console.log(`  Winner index: ${stage4[0].win_idx}`)
      console.log(`  Resolved at: ${stage4[0].resolved_at}\n`)
    } else {
      console.log(`Resolution found: NO (market unresolved)\n`)
    }

    // STAGE 5: realized_pnl_by_market_backup_20251111 (final output)
    console.log('=' .repeat(80))
    console.log('STAGE 5: realized_pnl_by_market_backup_20251111 (final P&L)')
    console.log('='.repeat(80) + '\n')

    const stage5Result = await client.query({
      query: `
        SELECT
          wallet,
          condition_id_norm,
          realized_pnl_usd
        FROM realized_pnl_by_market_backup_20251111
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
          AND lower(wallet) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    })
    const stage5 = await stage5Result.json<any[]>()

    if (stage5.length > 0) {
      console.log(`❌ PHANTOM IN FINAL OUTPUT`)
      console.log(`  P&L: $${(parseFloat(stage5[0].realized_pnl_usd) / 1000).toFixed(1)}K\n`)
    } else {
      console.log(`✅ Not in final output (unexpected)\n`)
    }

    // SUMMARY
    console.log('=' .repeat(80))
    console.log('PIPELINE TRACE SUMMARY')
    console.log('='.repeat(80) + '\n')

    console.log('Stage 1 (vw_clob_fills_enriched):       ' + (stage1Count > 0 ? '❌ PHANTOM' : '✅ CLEAN'))
    console.log('Stage 2 (trade_cashflows_v3):           ' + (stage2.length > 0 ? '❌ PHANTOM' : '✅ CLEAN'))
    console.log('Stage 3 (outcome_positions_v2):         ' + (stage3.length > 0 ? '❌ PHANTOM' : '✅ CLEAN'))
    console.log('Stage 4 (winning_index):                ' + (stage4.length > 0 ? '✅ HAS RESOLUTION' : 'NO RESOLUTION'))
    console.log('Stage 5 (realized_pnl_by_market_final): ' + (stage5.length > 0 ? '❌ PHANTOM' : '✅ CLEAN'))
    console.log('')

    // Identify where phantom appears first
    if (stage1Count > 0) {
      console.log('🔍 ROOT CAUSE: Phantom appears in source fills (vw_clob_fills_enriched)')
      console.log('   This means enrichment process is wrong')
    } else if (stage2.length > 0) {
      console.log('🔍 ROOT CAUSE: Phantom appears in trade_cashflows_v3')
      console.log('   This means cashflow aggregation is pulling wrong fills')
    } else if (stage3.length > 0) {
      console.log('🔍 ROOT CAUSE: Phantom appears in outcome_positions_v2')
      console.log('   This means position calculation is pulling wrong data')
      console.log('   CHECK: How is outcome_positions_v2 built? What are its source tables?')
    } else {
      console.log('🔍 ROOT CAUSE: Phantom appears only in final P&L table')
      console.log('   This means the JOIN in rebuild-pnl-materialized.ts is wrong')
    }

    console.log('\nNext: Inspect the table where phantom first appears\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
  } finally {
    await client.close()
  }
}

tracePipeline()
