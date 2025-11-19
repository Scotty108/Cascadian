import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculateRealizedPnL() {
  console.log('Calculating overall realized P&L for XCN wallet...\n');

  const query = `
    WITH trades AS (
      SELECT
        condition_id_norm_v3 AS cid,
        outcome_index_v3 AS outcome,
        sum(CASE WHEN trade_direction = 'BUY' THEN shares ELSE 0 END) -
        sum(CASE WHEN trade_direction = 'SELL' THEN shares ELSE 0 END) AS net_shares,
        sum(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) AS cost_buy,
        sum(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) AS proceeds_sell
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${XCN_WALLET}'
        AND condition_id_norm_v3 != ''
      GROUP BY cid, outcome
    )
    SELECT
      sum(proceeds_sell - cost_buy) AS total_trade_pnl,
      sumIf(net_shares, r.winning_index = outcome) AS total_winning_shares,
      sum(proceeds_sell - cost_buy + CASE WHEN r.winning_index = outcome THEN net_shares ELSE 0 END) AS total_realized_pnl,
      count() AS total_market_positions,
      countIf(r.condition_id_norm != '') AS resolved_positions
    FROM trades t
    LEFT JOIN market_resolutions_final r ON t.cid = r.condition_id_norm
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  if (data.length === 0) {
    console.log('❌ No data returned');
    return;
  }

  const row = data[0];

  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET OVERALL REALIZED P&L');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${XCN_WALLET}\n`);

  console.log('BREAKDOWN:');
  console.log(`  Total market×outcome positions: ${row.total_market_positions.toLocaleString()}`);
  console.log(`  Resolved positions: ${row.resolved_positions.toLocaleString()}`);
  console.log(`  Unresolved positions: ${(row.total_market_positions - row.resolved_positions).toLocaleString()}\n`);

  console.log('P&L CALCULATION:');
  console.log(`  Trade P&L (sell proceeds - buy cost): $${parseFloat(row.total_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Winning shares settlement value (+$1/share): $${parseFloat(row.total_winning_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('TOTAL REALIZED P&L:');
  console.log(`  $${parseFloat(row.total_realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

calculateRealizedPnL()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
