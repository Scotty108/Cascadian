import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("HYPOTHESIS: Closed positions account for missing $52K");
  console.log("═".repeat(80));
  console.log();

  // Query to find positions that would be filtered by HAVING abs(net_shares) > 0.0001
  const query = `
    WITH positions_all AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * (cf.size / 1000000.0)) AS net_shares
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL
        AND cf.condition_id != ''
        AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
    ),
    cashflows_all AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(round((cf.price * (cf.size / 1000000.0)) * if(cf.side = 'BUY', -1, 1), 8)) AS total_cashflow
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
      p.condition_id_norm,
      p.outcome_idx,
      p.net_shares,
      cf.total_cashflow,
      CASE
        WHEN abs(p.net_shares) <= 0.0001 THEN 'FILTERED (closed)'
        ELSE 'KEPT (open)'
      END as status,
      wi.win_idx,
      CASE
        WHEN wi.win_idx IS NOT NULL THEN
          CASE
            WHEN abs(p.net_shares) <= 0.0001 THEN
              -- Closed position: only cashflow
              cf.total_cashflow
            WHEN p.outcome_idx = wi.win_idx THEN
              -- Open winning position: cashflow + payout
              cf.total_cashflow + p.net_shares
            ELSE
              -- Open losing position: only cashflow
              cf.total_cashflow
          END
        ELSE
          0.0  -- Unresolved
      END as realized_pnl
    FROM positions_all p
    LEFT JOIN cashflows_all cf USING (wallet, condition_id_norm, outcome_idx)
    LEFT JOIN winning_index wi ON wi.condition_id_norm = p.condition_id_norm
    WHERE wi.win_idx IS NOT NULL
    ORDER BY abs(p.net_shares) ASC
  `;

  const res = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });
  const rows = await res.json();

  // Split into filtered vs kept
  const filtered = rows.filter(r => r.status === 'FILTERED (closed)');
  const kept = rows.filter(r => r.status === 'KEPT (open)');

  console.log(`Total resolved positions: ${rows.length}`);
  console.log(`  - Closed (would be filtered): ${filtered.length}`);
  console.log(`  - Open (kept): ${kept.length}`);
  console.log();

  const filteredPnL = filtered.reduce((sum, r) => sum + Number(r.realized_pnl), 0);
  const keptPnL = kept.reduce((sum, r) => sum + Number(r.realized_pnl), 0);
  const totalPnL = filteredPnL + keptPnL;

  console.log("P&L Breakdown:");
  console.log(`  Closed positions P&L:  $${filteredPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Open positions P&L:    $${keptPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Total P&L:             $${totalPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log();
  console.log(`  Current (filtered):    $${keptPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Expected (Dome):       $87,030.51`);
  console.log(`  Missing amount:        $${(87030.51 - keptPnL).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Recovered by fix:      $${filteredPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log();

  const variance = Math.abs(totalPnL - 87030.51) / 87030.51 * 100;
  console.log(`  New variance:          ${variance.toFixed(2)}%`);

  if (variance < 2) {
    console.log(`  ✅ <2% VARIANCE - FIX CONFIRMED!`);
  } else if (variance < 10) {
    console.log(`  ⚠️  <10% variance - Significant improvement`);
  } else {
    console.log(`  ❌ >10% variance - Other issues remain`);
  }
  console.log();

  // Show sample closed positions
  console.log("Sample Closed Positions (first 10):");
  console.table(filtered.slice(0, 10).map(r => ({
    condition_id: r.condition_id_norm.substring(0, 12) + '...',
    outcome: r.outcome_idx,
    net_shares: Number(r.net_shares).toFixed(4),
    cashflow: Number(r.total_cashflow).toFixed(2),
    pnl: Number(r.realized_pnl).toFixed(2)
  })));

  console.log("═".repeat(80));
}

main().catch(console.error);
