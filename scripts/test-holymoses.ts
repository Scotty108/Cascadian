import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

config({ path: '.env.local' });

async function testHolyMoses() {
  console.log("=".repeat(80));
  console.log("TESTING HOLYMOSES7: 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8");
  console.log("=".repeat(80));

  const query1 = `
    SELECT 'wallet_pnl_summary_v2' as source, wallet, realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd
    FROM wallet_pnl_summary_v2
    WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'

    UNION ALL

    SELECT 'wallet_realized_pnl_v2' as source, wallet, realized_pnl_usd, 0, realized_pnl_usd
    FROM wallet_realized_pnl_v2
    WHERE wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'

    UNION ALL

    SELECT 'trades_raw sum' as source, '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8' as wallet,
           SUM(realized_pnl_usd), 0, SUM(realized_pnl_usd)
    FROM trades_raw
    WHERE lower(wallet_address) = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
  `;

  const result1 = await clickhouse.query({ query: query1, format: 'JSONEachRow' });
  const data1 = await result1.json() as any[];

  console.log("\n📊 P&L COMPARISON:");
  for (const row of data1) {
    const source = String(row.source).padEnd(30);
    console.log("   " + source + ": $" + (row.realized_pnl_usd?.toLocaleString() || 'N/A') + " realized");
  }

  const query2 = `
    SELECT
      is_resolved,
      COUNT(*) as trade_count,
      SUM(realized_pnl_usd) as total_pnl
    FROM trades_raw
    WHERE lower(wallet_address) = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
    GROUP BY is_resolved
  `;

  const result2 = await clickhouse.query({ query: query2, format: 'JSONEachRow' });
  const data2 = await result2.json() as any[];

  console.log("\n📈 TRADE BREAKDOWN:");
  for (const row of data2) {
    const status = row.is_resolved === 1 ? 'Resolved' : 'Unresolved';
    console.log("   " + status + ":    " + row.trade_count + " trades, $" + (row.total_pnl?.toLocaleString() || '0') + " P&L");
  }
}

testHolyMoses().catch(console.error);
