#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function runQuery(name: string, query: string) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(name)
  console.log('='.repeat(60))
  try {
    const result = await clickhouse.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 60 }
    })
    const data = await result.json()
    console.log(JSON.stringify(data, null, 2))
    return data
  } catch (error) {
    console.error(`❌ ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return null
  }
}

async function main() {
  console.log('\n🔍 VALIDATING PnL DATA (using direct queries)')

  // 1. Sample enriched trades
  await runQuery('SAMPLE: Enriched trades (5)',
    `SELECT
      t.trader_wallet,
      t.side,
      m.condition_id,
      md.category,
      t.usdc_amount / 1000000.0 as usdc_amount,
      t.token_amount / 1000000.0 as shares,
      IF(t.token_amount > 0, t.usdc_amount / t.token_amount, 0) as price,
      t.trade_time
    FROM pm_trader_events_v2 AS t
    INNER JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    WHERE t.is_deleted = 0
    LIMIT 5`)

  // 2. Wallet PnL summary (small sample)
  await runQuery('SAMPLE: Wallet PnL for top trader',
    `SELECT
      t.trader_wallet as wallet,
      m.condition_id,
      any(md.question) as question,
      sumIf(t.usdc_amount, lower(t.side) = 'buy') / 1000000.0 as total_bought_usdc,
      sumIf(t.usdc_amount, lower(t.side) = 'sell') / 1000000.0 as total_sold_usdc,
      (sumIf(t.usdc_amount, lower(t.side) = 'sell') - sumIf(t.usdc_amount, lower(t.side) = 'buy')) / 1000000.0 as trading_pnl,
      count() as total_trades
    FROM pm_trader_events_v2 AS t
    INNER JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    LEFT JOIN pm_condition_resolutions AS r ON r.condition_id = m.condition_id
    WHERE t.is_deleted = 0
      AND r.condition_id IS NOT NULL  -- Only resolved markets
    GROUP BY t.trader_wallet, m.condition_id
    ORDER BY trading_pnl DESC
    LIMIT 10`)

  // 3. Verify resolution join works
  await runQuery('VERIFY: Resolution join',
    `SELECT
      m.condition_id,
      any(md.question) as question,
      any(r.payout_numerators) as payout_numerators,
      any(r.payout_denominator) as payout_denominator,
      any(r.resolved_at) as resolved_at,
      count() as trades_in_market
    FROM pm_trader_events_v2 AS t
    INNER JOIN pm_token_to_condition_map AS m ON m.token_id_dec = t.token_id
    LEFT JOIN pm_market_metadata AS md ON md.condition_id = m.condition_id
    INNER JOIN pm_condition_resolutions AS r ON r.condition_id = m.condition_id
    WHERE t.is_deleted = 0
    GROUP BY m.condition_id
    ORDER BY trades_in_market DESC
    LIMIT 5`)

  // 4. Overall stats
  await runQuery('STATS: Overall pipeline metrics',
    `SELECT
      count() as total_trades,
      countDistinct(trader_wallet) as unique_wallets,
      countDistinct(token_id) as unique_tokens,
      sum(usdc_amount) / 1e12 as total_volume_trillion_raw,
      min(trade_time) as earliest_trade,
      max(trade_time) as latest_trade
    FROM pm_trader_events_v2
    WHERE is_deleted = 0`)

  await clickhouse.close()
  console.log('\n✅ Validation complete!')
}

main().catch(console.error)
