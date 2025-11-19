import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("TEST #1: Closed Trades from RAW clob_fills");
  console.log("═".repeat(80));
  console.log();
  console.log("Querying clob_fills DIRECTLY (no HAVING filter)...");
  console.log();

  // Query clob_fills directly without HAVING filter
  const query = `
    WITH raw_positions AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares_raw,
        sum(round(cf.price * cf.size * if(cf.side = 'BUY', -1, 1), 8)) AS cashflow_raw
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL
        AND cf.condition_id != ''
        AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
    )
    SELECT
      rp.condition_id_norm,
      rp.outcome_idx,
      rp.net_shares_raw / 1000000.0 AS net_shares,
      rp.cashflow_raw / 1000000.0 AS cashflow,
      wi.win_idx,
      CASE
        WHEN wi.win_idx IS NOT NULL THEN
          CASE
            WHEN rp.outcome_idx = wi.win_idx THEN
              -- Winning position: cashflow + payout
              (rp.net_shares_raw + rp.cashflow_raw) / 1000000.0
            ELSE
              -- Losing position: only cashflow
              rp.cashflow_raw / 1000000.0
          END
        ELSE
          0.0  -- Unresolved
      END AS realized_pnl,
      CASE
        WHEN abs(rp.net_shares_raw) <= 0.0001 THEN 'CLOSED'
        ELSE 'OPEN'
      END AS position_status
    FROM raw_positions rp
    LEFT JOIN winning_index wi ON wi.condition_id_norm = rp.condition_id_norm
    WHERE wi.win_idx IS NOT NULL
    ORDER BY abs(rp.net_shares_raw) ASC, realized_pnl DESC
  `;

  const res = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });
  const rows = await res.json();

  // Split by position status
  const closedPositions = rows.filter(r => r.position_status === 'CLOSED');
  const openPositions = rows.filter(r => r.position_status === 'OPEN');

  const closedPnL = closedPositions.reduce((sum, r) => sum + Number(r.realized_pnl), 0);
  const openPnL = openPositions.reduce((sum, r) => sum + Number(r.realized_pnl), 0);
  const totalPnL = closedPnL + openPnL;

  console.log("═".repeat(80));
  console.log("RESULTS:");
  console.log(`  Total positions (resolved): ${rows.length}`);
  console.log(`    - CLOSED (abs(shares) <= 0.0001): ${closedPositions.length}`);
  console.log(`    - OPEN (abs(shares) > 0.0001):    ${openPositions.length}`);
  console.log();
  console.log("P&L Breakdown:");
  console.log(`  CLOSED positions:  $${closedPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  OPEN positions:    $${openPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  TOTAL P&L:         $${totalPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log();
  console.log("Comparison:");
  console.log(`  Current (with filter): $34,990.56`);
  console.log(`  Expected (Dome):       $87,030.51`);
  console.log(`  Gap:                   $${(87030.51 - 34990.56).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log();
  console.log(`  Closed P&L vs Gap:     $${closedPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} vs $52,040`);
  console.log();

  const variance = Math.abs(totalPnL - 87030.51) / 87030.51 * 100;
  console.log(`  New total variance:    ${variance.toFixed(2)}%`);

  if (variance < 2) {
    console.log(`  ✅ <2% VARIANCE - CLOSED TRADES WERE THE ISSUE!`);
  } else if (variance < 10) {
    console.log(`  ⚠️  Improved but still gap - partial explanation`);
  } else {
    console.log(`  ❌ Closed trades don't explain the gap`);
  }
  console.log("═".repeat(80));
  console.log();

  if (closedPositions.length > 0) {
    console.log("Sample CLOSED positions (first 10):");
    console.table(closedPositions.slice(0, 10).map(r => ({
      condition_id: r.condition_id_norm.substring(0, 12) + '...',
      outcome: r.outcome_idx,
      net_shares: Number(r.net_shares).toFixed(6),
      cashflow: Number(r.cashflow).toFixed(2),
      win_idx: r.win_idx,
      pnl: Number(r.realized_pnl).toFixed(2)
    })));
  }
}

main().catch(console.error);
