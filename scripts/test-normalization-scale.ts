#!/usr/bin/env npx tsx

/**
 * Test if division by 1e6 produces expected scale
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const XCN = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('Testing if division by 1e6 produces correct scale...\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        sum(toFloat64(usd_value) / 1000000 * if(trade_direction='SELL', 1, -1)) AS total_trade_pnl,
        sum(toFloat64(usd_value) / 1000000) AS total_trade_volume,
        count() AS total_trades,
        uniq(cid_norm) AS unique_markets
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${XCN}'
        AND cid_norm != ''
    `,
    format: 'JSONEachRow'
  })

  const data = await result.json<any>()
  const row = data[0]

  console.log('Results with /1e6 normalization:')
  console.log('  Trade P&L:      $' + parseFloat(row.total_trade_pnl).toLocaleString('en-US', {minimumFractionDigits: 2}))
  console.log('  Trade Volume:   $' + parseFloat(row.total_trade_volume).toLocaleString('en-US', {minimumFractionDigits: 2}))
  console.log('  Total Trades:   ' + parseInt(row.total_trades).toLocaleString('en-US'))
  console.log('  Unique Markets: ' + parseInt(row.unique_markets).toLocaleString('en-US'))
  console.log()
  console.log('Expected: Volume ~$1-2M, P&L ~$80-100K')
  console.log('Match? Volume:', parseFloat(row.total_trade_volume) >= 1000000 && parseFloat(row.total_trade_volume) <= 2000000 ? '✅' : '❌')
  console.log('       P&L range:', parseFloat(row.total_trade_pnl) >= -200000 && parseFloat(row.total_trade_pnl) <= 200000 ? '✅' : '❌')

  await clickhouse.close()
}

main().catch(console.error)
