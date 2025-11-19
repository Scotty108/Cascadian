import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function findAllXiMarkets() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 SEARCHING: All Xi Jinping Markets for XCN Wallet');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  try {
    // Search for all markets with "xi" or "jinping" in any related fields
    // Group by cid_norm to find all unique markets
    const searchQuery = `
      SELECT
        cid_norm,
        count(*) AS trades,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade,
        sumIf(usd_value, trade_direction='BUY') AS cost,
        sumIf(usd_value, trade_direction='SELL') AS proceeds,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        proceeds - cost AS trade_pnl
      FROM vw_xcn_repaired_only
      WHERE 1=1
      GROUP BY cid_norm
      HAVING trades > 100  -- Only markets with significant activity
      ORDER BY trades DESC
      LIMIT 50
    `;

    const result = await clickhouse.query({ query: searchQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    console.log(`Found ${data.length} markets with 100+ trades\n`);

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('TOP 50 MARKETS BY TRADE COUNT');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    data.forEach((row, i) => {
      const trades = Number(row.trades);
      const cost = Number(row.cost);
      const net_shares = Number(row.net_shares);
      const pnl = Number(row.trade_pnl);

      console.log(`${(i+1).toString().padStart(2)}. CID: ${row.cid_norm}`);
      console.log(`    Trades:     ${trades.toLocaleString()}`);
      console.log(`    Period:     ${row.first_trade} to ${row.last_trade}`);
      console.log(`    Cost:       $${cost.toLocaleString()}`);
      console.log(`    Net Shares: ${net_shares.toLocaleString()}`);
      console.log(`    Trade PnL:  $${pnl.toLocaleString()}`);

      // Check if this matches the "Xi out before October" fingerprint
      const matches_oct = Math.abs(cost - 8160) < 100 && Math.abs(net_shares - 8164.9) < 100;
      if (matches_oct) {
        console.log(`    >>> 🎯 POSSIBLE MATCH: Xi out before October (cost ~$8.2k, shares ~8.1k)`);
      }

      // Check if this matches the eggs fingerprint
      const matches_eggs = Math.abs(cost - 12400) < 100 && Math.abs(net_shares - 53683) < 1000;
      if (matches_eggs) {
        console.log(`    >>> 🎯 POSSIBLE MATCH: Eggs fingerprint (cost ~$12.4k, shares ~53k)`);
      }

      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('SPECIFIC MARKET CHECKS');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    // Check the specific CID we've been using
    const xi_cid = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
    const xiMatch = data.find(r => r.cid_norm === xi_cid);

    if (xiMatch) {
      console.log(`✅ CID f2ce8d3897... IS in the top 50 markets:`);
      console.log(`   Rank: #${data.findIndex(r => r.cid_norm === xi_cid) + 1}`);
      console.log(`   Trades: ${Number(xiMatch.trades).toLocaleString()}`);
      console.log(`   Cost: $${Number(xiMatch.cost).toLocaleString()}`);
      console.log(`   This is likely "Xi Jinping out in 2025?"\n`);
    } else {
      console.log(`❌ CID f2ce8d3897... NOT in top 50 markets\n`);
    }

    // Look for markets matching the "Xi out before October" fingerprint
    console.log('Looking for "Xi out before October" pattern:');
    console.log('  Expected: cost ~$8,160, shares ~8,165 No, PnL ~$420\n');

    const octMatches = data.filter(r => {
      const cost = Number(r.cost);
      const shares = Number(r.net_shares);
      return Math.abs(cost - 8160) < 500 && Math.abs(shares - 8165) < 500;
    });

    if (octMatches.length > 0) {
      console.log(`✅ Found ${octMatches.length} potential match(es):\n`);
      octMatches.forEach(match => {
        console.log(`   CID: ${match.cid_norm}`);
        console.log(`   Cost: $${Number(match.cost).toLocaleString()}`);
        console.log(`   Shares: ${Number(match.net_shares).toLocaleString()}`);
        console.log(`   PnL: $${Number(match.trade_pnl).toLocaleString()}\n`);
      });
    } else {
      console.log(`❌ No matches for "Xi out before October" fingerprint\n`);
    }

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
  }
}

findAllXiMarkets().catch(console.error);
