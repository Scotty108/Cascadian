import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function findXiOctoberMarket() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 SEARCHING: "Xi out before October" Market');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Target fingerprint from Polymarket UI:');
  console.log('  8,164.9 No shares at 95¢');
  console.log('  Cost: $8,160.09');
  console.log('  PnL: $420.11 (5.43%)\n');

  try {
    // Search for markets with cost between $7k-$9k and shares around 8k
    const searchQuery = `
      SELECT
        cid_norm,
        count(*) AS trades,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade,
        sumIf(usd_value, trade_direction='BUY') AS cost,
        sumIf(usd_value, trade_direction='SELL') AS proceeds,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        proceeds - cost AS trade_pnl,
        min(price) AS min_price,
        max(price) AS max_price,
        avg(price) AS avg_price
      FROM vw_xcn_repaired_only
      GROUP BY cid_norm
      HAVING cost >= 7000 AND cost <= 9000
         AND net_shares >= 7000 AND net_shares <= 9500
         AND trade_pnl >= 200 AND trade_pnl <= 700
      ORDER BY abs(cost - 8160) + abs(net_shares - 8164.9) + abs(trade_pnl - 420)
      LIMIT 10
    `;

    const result = await clickhouse.query({ query: searchQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (data.length === 0) {
      console.log('❌ NO EXACT MATCHES FOUND\n');
      console.log('Broadening search to cost $7k-$9k only...\n');

      // Broader search - just cost range
      const broaderQuery = `
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
        HAVING cost >= 7000 AND cost <= 9000
        ORDER BY abs(cost - 8160)
        LIMIT 20
      `;

      const broaderResult = await clickhouse.query({ query: broaderQuery, format: 'JSONEachRow' });
      const broaderData = await broaderResult.json<any[]>();

      console.log(`Found ${broaderData.length} markets with cost $7k-$9k:\n`);

      broaderData.forEach((row, i) => {
        const cost = Number(row.cost);
        const net_shares = Number(row.net_shares);
        const pnl = Number(row.trade_pnl);
        const trades = Number(row.trades);

        console.log(`${(i+1).toString().padStart(2)}. CID: ${row.cid_norm.substring(0, 16)}...`);
        console.log(`    Trades:     ${trades.toLocaleString()}`);
        console.log(`    Cost:       $${cost.toLocaleString()} (${((cost - 8160) / 8160 * 100).toFixed(1)}% off)`);
        console.log(`    Net Shares: ${net_shares.toLocaleString()}`);
        console.log(`    PnL:        $${pnl.toLocaleString()}`);
        console.log(`    Period:     ${row.first_trade} to ${row.last_trade}\n`);
      });

    } else {
      console.log(`✅ FOUND ${data.length} POTENTIAL MATCH(ES)\n`);

      data.forEach((row, i) => {
        const cost = Number(row.cost);
        const net_shares = Number(row.net_shares);
        const pnl = Number(row.trade_pnl);
        const trades = Number(row.trades);

        const cost_diff = ((cost / 8160 - 1) * 100).toFixed(2);
        const shares_diff = ((net_shares / 8164.9 - 1) * 100).toFixed(2);
        const pnl_diff = ((pnl / 420 - 1) * 100).toFixed(2);

        console.log(`═══════════════════════════════════════════════════════════════════════════════`);
        console.log(`MATCH #${i+1}`);
        console.log(`═══════════════════════════════════════════════════════════════════════════════\n`);

        console.log(`CID: ${row.cid_norm}\n`);

        console.log('Metrics:');
        console.log(`  Trades:     ${trades.toLocaleString()}`);
        console.log(`  Cost:       $${cost.toLocaleString()} (${cost_diff}% off)`);
        console.log(`  Proceeds:   $${Number(row.proceeds).toLocaleString()}`);
        console.log(`  Net Shares: ${net_shares.toLocaleString()} (${shares_diff}% off)`);
        console.log(`  PnL:        $${pnl.toLocaleString()} (${pnl_diff}% off)\n`);

        console.log(`Period: ${row.first_trade} to ${row.last_trade}`);
        console.log(`Price Range: $${Number(row.min_price).toFixed(4)} - $${Number(row.max_price).toFixed(4)}\n`);
      });
    }

    // Also check the specific Xi 2025 CID we were using
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('CHECKING: Xi Jinping out in 2025 CID (f2ce8d3897...)');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const xiQuery = `
      SELECT
        cid_norm,
        count(*) AS trades,
        sumIf(usd_value, trade_direction='BUY') AS cost,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        sumIf(usd_value, trade_direction='SELL') - sumIf(usd_value, trade_direction='BUY') AS trade_pnl
      FROM vw_xcn_repaired_only
      WHERE cid_norm = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
      GROUP BY cid_norm
    `;

    const xiResult = await clickhouse.query({ query: xiQuery, format: 'JSONEachRow' });
    const xiData = await xiResult.json<any[]>();

    if (xiData.length > 0) {
      const xi = xiData[0];
      console.log('✅ Found Xi 2025 market:');
      console.log(`   Trades: ${Number(xi.trades).toLocaleString()}`);
      console.log(`   Cost: $${Number(xi.cost).toLocaleString()}`);
      console.log(`   Net Shares: ${Number(xi.net_shares).toLocaleString()}`);
      console.log(`   PnL: $${Number(xi.trade_pnl).toLocaleString()}\n`);
      console.log('This is a DIFFERENT market than "Xi out before October"\n');
    } else {
      console.log('❌ Xi 2025 market not found in database\n');
    }

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
  }
}

findXiOctoberMarket().catch(console.error);
