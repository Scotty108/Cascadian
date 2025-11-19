import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Expected fingerprint from Polymarket
const EXPECTED = {
  cost: 12400,
  net_shares: 53683,
  pnl: 41000,
  tolerance: 0.15 // 15% tolerance for search
};

async function findMatchingFingerprint() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 SEARCHING: Markets Matching Xi Fingerprint');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Expected Fingerprint:');
  console.log(`  Cost:       $${EXPECTED.cost.toLocaleString()} ± ${(EXPECTED.tolerance * 100).toFixed(0)}%`);
  console.log(`  Net Shares: ${EXPECTED.net_shares.toLocaleString()} ± ${(EXPECTED.tolerance * 100).toFixed(0)}%`);
  console.log(`  PnL:        $${EXPECTED.pnl.toLocaleString()} ± ${(EXPECTED.tolerance * 100).toFixed(0)}%\n`);

  const cost_min = EXPECTED.cost * (1 - EXPECTED.tolerance);
  const cost_max = EXPECTED.cost * (1 + EXPECTED.tolerance);
  const shares_min = EXPECTED.net_shares * (1 - EXPECTED.tolerance);
  const shares_max = EXPECTED.net_shares * (1 + EXPECTED.tolerance);
  const pnl_min = EXPECTED.pnl * (1 - EXPECTED.tolerance);
  const pnl_max = EXPECTED.pnl * (1 + EXPECTED.tolerance);

  console.log('Search Ranges:');
  console.log(`  Cost:       $${cost_min.toLocaleString()} to $${cost_max.toLocaleString()}`);
  console.log(`  Net Shares: ${shares_min.toLocaleString()} to ${shares_max.toLocaleString()}`);
  console.log(`  PnL:        $${pnl_min.toLocaleString()} to $${pnl_max.toLocaleString()}\n`);

  try {
    const searchQuery = `
      SELECT
        cid_norm,
        count(*) AS trades,
        sumIf(usd_value, trade_direction='BUY') AS cost,
        sumIf(usd_value, trade_direction='SELL') AS proceeds,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        proceeds - cost AS trade_pnl,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM vw_xcn_repaired_only
      GROUP BY cid_norm
      HAVING cost >= ${cost_min} AND cost <= ${cost_max}
         AND net_shares >= ${shares_min} AND net_shares <= ${shares_max}
         AND trade_pnl >= ${pnl_min} AND trade_pnl <= ${pnl_max}
      ORDER BY abs(cost - ${EXPECTED.cost}) + abs(net_shares - ${EXPECTED.net_shares}) + abs(trade_pnl - ${EXPECTED.pnl})
      LIMIT 10
    `;

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('QUERY RESULTS');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const result = await clickhouse.query({ query: searchQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (data.length === 0) {
      console.log('❌ NO MATCHES FOUND\n');
      console.log('No markets in vw_xcn_repaired_only match the expected fingerprint.\n');
      console.log('This suggests either:');
      console.log('  1. The fingerprint data is from a different wallet');
      console.log('  2. The wallet address 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e is incorrect');
      console.log('  3. The Polymarket API data is scoped differently\n');

      // Try a broader search
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('BROADER SEARCH: Cost Only (±30%)');
      console.log('═══════════════════════════════════════════════════════════════════════════════\n');

      const broaderQuery = `
        SELECT
          cid_norm,
          count(*) AS trades,
          sumIf(usd_value, trade_direction='BUY') AS cost,
          sumIf(usd_value, trade_direction='SELL') AS proceeds,
          sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
          proceeds - cost AS trade_pnl
        FROM vw_xcn_repaired_only
        GROUP BY cid_norm
        HAVING cost >= ${EXPECTED.cost * 0.7} AND cost <= ${EXPECTED.cost * 1.3}
        ORDER BY abs(cost - ${EXPECTED.cost})
        LIMIT 20
      `;

      const broaderResult = await clickhouse.query({ query: broaderQuery, format: 'JSONEachRow' });
      const broaderData = await broaderResult.json<any[]>();

      console.log(`Found ${broaderData.length} markets with cost between $${(EXPECTED.cost * 0.7).toLocaleString()} and $${(EXPECTED.cost * 1.3).toLocaleString()}:\n`);

      broaderData.forEach((row, i) => {
        const cost = Number(row.cost);
        const net_shares = Number(row.net_shares);
        const pnl = Number(row.trade_pnl);
        const trades = Number(row.trades);

        console.log(`${(i+1).toString().padStart(2)}. CID: ${row.cid_norm.substring(0, 16)}...`);
        console.log(`    Trades: ${trades.toLocaleString()}`);
        console.log(`    Cost:   $${cost.toLocaleString()} (${((cost / EXPECTED.cost - 1) * 100).toFixed(1)}% off)`);
        console.log(`    Shares: ${net_shares.toLocaleString()} (${((net_shares / EXPECTED.net_shares - 1) * 100).toFixed(1)}% off)`);
        console.log(`    PnL:    $${pnl.toLocaleString()} (${((pnl / EXPECTED.pnl - 1) * 100).toFixed(1)}% off)\n`);
      });

    } else {
      console.log(`✅ FOUND ${data.length} MATCHING MARKET(S)\n`);

      data.forEach((row, i) => {
        const cost = Number(row.cost);
        const proceeds = Number(row.proceeds);
        const net_shares = Number(row.net_shares);
        const pnl = Number(row.trade_pnl);
        const trades = Number(row.trades);

        const cost_diff = ((cost / EXPECTED.cost - 1) * 100).toFixed(1);
        const shares_diff = ((net_shares / EXPECTED.net_shares - 1) * 100).toFixed(1);
        const pnl_diff = ((pnl / EXPECTED.pnl - 1) * 100).toFixed(1);

        console.log(`═══════════════════════════════════════════════════════════════════════════════`);
        console.log(`MATCH #${i+1}`);
        console.log(`═══════════════════════════════════════════════════════════════════════════════\n`);

        console.log(`Condition ID: ${row.cid_norm}\n`);

        console.log('Metrics:');
        console.log(`  Trades:     ${trades.toLocaleString()}`);
        console.log(`  Cost:       $${cost.toLocaleString()} (${cost_diff}% off)`);
        console.log(`  Proceeds:   $${proceeds.toLocaleString()}`);
        console.log(`  Net Shares: ${net_shares.toLocaleString()} (${shares_diff}% off)`);
        console.log(`  PnL:        $${pnl.toLocaleString()} (${pnl_diff}% off)\n`);

        console.log(`Date Range: ${row.first_trade} to ${row.last_trade}\n`);

        // Check if this matches the Xi CID we were given
        const xi_cid = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
        if (row.cid_norm === xi_cid) {
          console.log('⚠️  This IS the Xi Jinping market we validated earlier!\n');
        } else {
          console.log('ℹ️  This is NOT the Xi market (different CID)\n');
        }
      });

      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('CONCLUSION');
      console.log('═══════════════════════════════════════════════════════════════════════════════\n');

      console.log(`Found ${data.length} market(s) matching the fingerprint.`);
      console.log('Use the CID from Match #1 for further investigation.\n');
    }

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
  }
}

findMatchingFingerprint().catch(console.error);
