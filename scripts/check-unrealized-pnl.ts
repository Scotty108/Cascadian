import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("TEST #4: Check for Unrealized P&L");
  console.log("═".repeat(80));
  console.log();

  // Check for unresolved markets with open positions
  const unresolvedQuery = `
    WITH positions AS (
      SELECT
        lower(cf.proxy_wallet) AS wallet,
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size / 1000000.0) AS net_shares,
        sum(round(cf.price * cf.size * if(cf.side = 'BUY', -1, 1), 8) / 1000000.0) AS net_cashflow
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL
        AND cf.condition_id != ''
        AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY wallet, condition_id_norm, outcome_idx
      HAVING abs(net_shares) > 0.0001
    )
    SELECT
      p.condition_id_norm,
      p.outcome_idx,
      p.net_shares,
      p.net_cashflow,
      wi.win_idx,
      CASE
        WHEN wi.win_idx IS NULL THEN 'UNRESOLVED'
        ELSE 'RESOLVED'
      END AS status
    FROM positions p
    LEFT JOIN winning_index wi ON wi.condition_id_norm = p.condition_id_norm
    ORDER BY status DESC, abs(p.net_shares) DESC
  `;

  const res = await clickhouse.query({
    query: unresolvedQuery,
    format: 'JSONEachRow'
  });
  const rows = await res.json();

  const resolved = rows.filter(r => r.status === 'RESOLVED');
  const unresolved = rows.filter(r => r.status === 'UNRESOLVED');

  console.log(`Total positions: ${rows.length}`);
  console.log(`  - RESOLVED:   ${resolved.length}`);
  console.log(`  - UNRESOLVED: ${unresolved.length}`);
  console.log();

  if (unresolved.length > 0) {
    // Calculate unrealized P&L (just cashflow for now, since we don't know outcomes)
    const unrealizedCashflow = unresolved.reduce((sum, r) => sum + Number(r.net_cashflow), 0);
    const unrealizedShares = unresolved.reduce((sum, r) => sum + Math.abs(Number(r.net_shares)), 0);

    console.log("UNRESOLVED Markets:");
    console.log(`  Net cashflow:        $${unrealizedCashflow.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log(`  Total abs(shares):   ${unrealizedShares.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
    console.log();
    console.log("Sample unresolved positions (first 10):");
    console.table(unresolved.slice(0, 10).map(r => ({
      condition_id: r.condition_id_norm.substring(0, 12) + '...',
      outcome: r.outcome_idx,
      net_shares: Number(r.net_shares).toFixed(2),
      cashflow: Number(r.net_cashflow).toFixed(2)
    })));
    console.log();

    console.log("Analysis:");
    console.log(`  If ALL unresolved positions win:  +$${unrealizedShares.toLocaleString()} (shares valued at $1)`);
    console.log(`  If ALL unresolved positions lose: $${unrealizedCashflow.toLocaleString()}`);
    console.log();

    // Check if this could account for the gap
    const potentialGain = unrealizedShares + unrealizedCashflow;
    console.log(`  Potential P&L range: $${unrealizedCashflow.toFixed(2)} to $${potentialGain.toFixed(2)}`);
    console.log(`  Gap to explain:      $52,040`);
    console.log();

    if (Math.abs(potentialGain - 52040) < 10000) {
      console.log(`  ⚠️  Unrealized P&L could account for the gap!`);
      console.log(`     Dome might be including unrealized positions at current market prices`);
    } else {
      console.log(`  ❌ Unrealized P&L doesn't explain the full gap`);
    }

  } else {
    console.log("✅ No unresolved positions found");
    console.log();
    console.log("This means the gap is NOT due to:");
    console.log("  - Unrealized P&L from open markets");
    console.log("  - Closed positions (already tested)");
    console.log("  - Fees (already tested)");
    console.log();
    console.log("⚠️  The gap must be from:");
    console.log("  1. Missing markets entirely (not in clob_fills)");
    console.log("  2. Different P&L calculation methodology vs Dome");
    console.log("  3. Time period mismatch");
  }

  console.log("═".repeat(80));
}

main().catch(console.error);
