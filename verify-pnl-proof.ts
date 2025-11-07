import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

// Load environment variables
config({ path: '.env.local' });

async function testPnL() {
  console.log("=".repeat(80));
  console.log("QUERY 1: ALL P&L DATA FOR NIGGEMON ACROSS ALL TABLES");
  console.log("=".repeat(80));

  const query1 = `
    SELECT 'wallet_pnl_summary_v2' as source, wallet, realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd
    FROM wallet_pnl_summary_v2
    WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'

    UNION ALL

    SELECT 'wallet_realized_pnl_v2' as source, wallet, realized_pnl_usd, 0, realized_pnl_usd
    FROM wallet_realized_pnl_v2
    WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'

    UNION ALL

    SELECT 'trades_raw sum' as source, '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0' as wallet,
           SUM(realized_pnl_usd), 0, SUM(realized_pnl_usd)
    FROM trades_raw
    WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  `;

  const result1 = await clickhouse.query({ query: query1, format: 'JSONEachRow' });
  const data1 = await result1.json() as any[];
  console.log(JSON.stringify(data1, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log("QUERY 2: SAMPLE OF ACTUAL TRADES FOR NIGGEMON (LAST 20)");
  console.log("=".repeat(80));

  const query2 = `
    SELECT
      timestamp,
      market_id,
      side,
      shares,
      entry_price,
      realized_pnl_usd,
      fee_usd,
      is_resolved
    FROM trades_raw
    WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
    ORDER BY timestamp DESC
    LIMIT 20
  `;

  const result2 = await clickhouse.query({ query: query2, format: 'JSONEachRow' });
  const data2 = await result2.json();
  console.log(JSON.stringify(data2, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log("QUERY 3: MARKET-BY-MARKET BREAKDOWN FOR NIGGEMON");
  console.log("=".repeat(80));

  const query3 = `
    SELECT
      market_id,
      COUNT(*) as trades,
      SUM(shares) as total_shares,
      SUM(toFloat64(entry_price) * shares) as notional_value,
      SUM(realized_pnl_usd) as pnl_trades_raw,
      is_resolved
    FROM trades_raw
    WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
    GROUP BY market_id, is_resolved
    ORDER BY ABS(SUM(realized_pnl_usd)) DESC
    LIMIT 20
  `;

  const result3 = await clickhouse.query({ query: query3, format: 'JSONEachRow' });
  const data3 = await result3.json();
  console.log(JSON.stringify(data3, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log("QUERY 4: TOTAL TRADE COUNT AND RESOLUTION STATUS");
  console.log("=".repeat(80));

  const query4 = `
    SELECT
      is_resolved,
      COUNT(*) as trade_count,
      SUM(realized_pnl_usd) as total_pnl,
      AVG(realized_pnl_usd) as avg_pnl
    FROM trades_raw
    WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
    GROUP BY is_resolved
  `;

  const result4 = await clickhouse.query({ query: query4, format: 'JSONEachRow' });
  const data4 = await result4.json() as any[];
  console.log(JSON.stringify(data4, null, 2));

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY AND VERIFICATION");
  console.log("=".repeat(80));

  // Extract the key numbers
  const tradesRawTotal = data1.find((r: any) => r.source === 'trades_raw sum');
  const walletPnlV2 = data1.find((r: any) => r.source === 'wallet_pnl_summary_v2');
  const realizedPnlV2 = data1.find((r: any) => r.source === 'wallet_realized_pnl_v2');

  console.log("\n📊 COMPARISON OF P&L VALUES:");
  console.log("   trades_raw (source of truth):        $" + (tradesRawTotal?.realized_pnl_usd?.toLocaleString() || 'N/A'));
  console.log("   wallet_realized_pnl_v2 (view):       $" + (realizedPnlV2?.realized_pnl_usd?.toLocaleString() || 'N/A'));
  console.log("   wallet_pnl_summary_v2 (full view):   $" + (walletPnlV2?.realized_pnl_usd?.toLocaleString() || 'N/A') + " realized");
  console.log("                                        $" + (walletPnlV2?.unrealized_pnl_usd?.toLocaleString() || 'N/A') + " unrealized");
  console.log("                                        $" + (walletPnlV2?.total_pnl_usd?.toLocaleString() || 'N/A') + " total");

  console.log("\n🎯 CLAIMED VALUE FROM POLYMARKET:");
  console.log("   $99,691 or $102,001 (reported in issue)");

  console.log("\n✅ VERIFICATION:");
  if (tradesRawTotal && Math.abs(tradesRawTotal.realized_pnl_usd - 99691) < 1000) {
    console.log("   ✓ System matches Polymarket claim within $1,000");
  } else if (tradesRawTotal && Math.abs(tradesRawTotal.realized_pnl_usd - 102001) < 1000) {
    console.log("   ✓ System matches alternative Polymarket claim within $1,000");
  } else {
    console.log("   ⚠️  Discrepancy detected: Database shows $" + (tradesRawTotal?.realized_pnl_usd?.toLocaleString() || 'N/A'));
  }

  const resolvedData = data4.find((r: any) => r.is_resolved === 1);
  const unresolvedData = data4.find((r: any) => r.is_resolved === 0);
  console.log("\n📈 TRADE BREAKDOWN:");
  console.log("   Resolved trades:    " + (resolvedData?.trade_count || 0) + " trades, $" + (resolvedData?.total_pnl?.toLocaleString() || 0) + " P&L");
  console.log("   Unresolved trades:  " + (unresolvedData?.trade_count || 0) + " trades, $" + (unresolvedData?.total_pnl?.toLocaleString() || 0) + " P&L");
}

testPnL().catch(console.error);
