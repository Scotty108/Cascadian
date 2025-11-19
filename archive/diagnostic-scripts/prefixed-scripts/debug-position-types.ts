import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('POSITION TYPE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get all positions and categorize them
  const query = await clickhouse.query({
    query: `
      SELECT
        f.condition_id_ctf,
        f.index_set_mask,
        f.net_shares,
        f.gross_cf,
        f.fees,
        t.pps,
        length(coalesce(t.pps, [])) > 0 AS has_resolution,
        abs(f.net_shares) < 1e-9 AS fully_closed,
        CASE
          WHEN abs(f.net_shares) < 1e-9 THEN 'CLOSED'
          WHEN length(coalesce(t.pps, [])) > 0 THEN 'RESOLVED_OPEN'
          ELSE 'UNRESOLVED_OPEN'
        END AS position_type
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t USING(condition_id_ctf)
      WHERE lower(f.wallet) = lower('${wallet}')
      ORDER BY abs(gross_cf) DESC
    `,
    format: 'JSONEachRow'
  });

  const positions: any[] = await query.json();

  // Categorize
  const closed = positions.filter(p => p.position_type === 'CLOSED');
  const resolvedOpen = positions.filter(p => p.position_type === 'RESOLVED_OPEN');
  const unresolvedOpen = positions.filter(p => p.position_type === 'UNRESOLVED_OPEN');

  console.log('Position Breakdown:');
  console.log(`   CLOSED (net_shares ≈ 0): ${closed.length}`);
  console.log(`   RESOLVED but still open: ${resolvedOpen.length}`);
  console.log(`   UNRESOLVED and open: ${unresolvedOpen.length}`);
  console.log(`   Total: ${positions.length}\n`);

  // Calculate P&L for each category
  console.log('P&L by Category:');
  console.log('─'.repeat(60));

  // Closed positions
  let closedPnl = 0;
  closed.forEach(p => {
    const payout = p.pps ? p.pps.reduce((sum: number, val: number, idx: number) => {
      const bitSet = (p.index_set_mask & (1 << idx)) > 0;
      return sum + (bitSet ? val : 0);
    }, 0) * p.net_shares : 0;
    const pnl = p.gross_cf - p.fees + payout;
    closedPnl += pnl;
  });

  console.log(`   CLOSED: $${closedPnl.toFixed(2)}`);

  // Resolved but open
  let resolvedOpenPnl = 0;
  console.log(`\n   RESOLVED but still open (${resolvedOpen.length} positions):`);
  resolvedOpen.slice(0, 10).forEach((p, i) => {
    const payout = p.pps.reduce((sum: number, val: number, idx: number) => {
      const bitSet = (p.index_set_mask & (1 << idx)) > 0;
      return sum + (bitSet ? val : 0);
    }, 0) * p.net_shares;
    const pnl = p.gross_cf - p.fees + payout;
    resolvedOpenPnl += pnl;
    if (i < 5) {
      console.log(`      ${(i + 1).toString().padStart(2)}. net_shares=${p.net_shares.toFixed(2)}, cf=$${p.gross_cf.toFixed(2)}, payout=$${payout.toFixed(2)}, pnl=$${pnl.toFixed(2)}`);
    }
  });
  resolvedOpen.slice(10).forEach(p => {
    const payout = p.pps.reduce((sum: number, val: number, idx: number) => {
      const bitSet = (p.index_set_mask & (1 << idx)) > 0;
      return sum + (bitSet ? val : 0);
    }, 0) * p.net_shares;
    const pnl = p.gross_cf - p.fees + payout;
    resolvedOpenPnl += pnl;
  });

  console.log(`   RESOLVED OPEN Total: $${resolvedOpenPnl.toFixed(2)}`);

  // Unresolved and open
  console.log(`\n   UNRESOLVED and open (${unresolvedOpen.length} positions):`);
  let unresolvedCost = 0;
  unresolvedOpen.slice(0, 5).forEach((p, i) => {
    unresolvedCost += p.gross_cf - p.fees;
    console.log(`      ${(i + 1).toString().padStart(2)}. net_shares=${p.net_shares.toFixed(2)}, cost=$${(p.gross_cf - p.fees).toFixed(2)}`);
  });
  unresolvedOpen.slice(5).forEach(p => {
    unresolvedCost += p.gross_cf - p.fees;
  });

  console.log(`   UNRESOLVED OPEN Cost: $${unresolvedCost.toFixed(2)}`);
  console.log(`   (Cannot calculate P&L without resolution or current prices)\n`);

  // Total
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TOTAL P&L');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const totalRealized = closedPnl + resolvedOpenPnl;
  console.log(`   Realized (closed + resolved open): $${totalRealized.toFixed(2)}`);
  console.log(`   Unresolved cost: $${unresolvedCost.toFixed(2)}`);
  console.log(`\n   To match DOME's $87,030.51, the ${unresolvedOpen.length} unresolved positions`);
  console.log(`   would need a mark-to-market value of: $${(87030.51 - totalRealized).toFixed(2)}`);
  console.log(`   That's a ${(((87030.51 - totalRealized) / Math.abs(unresolvedCost)) * 100).toFixed(0)}% gain on those positions.\n`);

  // Show what wallet_realized_pnl gives us
  const dbPnlQuery = await clickhouse.query({
    query: `
      SELECT round(sum(pnl_net),2) AS pnl_net
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const dbPnl = await dbPnlQuery.json();

  console.log(`   Database wallet_realized_pnl: $${Number(dbPnl[0].pnl_net).toLocaleString()}`);
  console.log(`   Our calculation: $${totalRealized.toFixed(2)}`);
  console.log(`   Match: ${Math.abs(Number(dbPnl[0].pnl_net) - totalRealized) < 1 ? '✅' : '❌'}\n`);
}

main().catch(console.error);
