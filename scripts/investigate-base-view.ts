import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

config({ path: '.env.local' });

async function investigateBaseView() {
  const query = `
    SELECT
      name,
      create_table_query
    FROM system.tables
    WHERE database = currentDatabase()
    AND name = 'realized_pnl_by_market_v2'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  for (const row of data as any[]) {
    console.log("VIEW: " + row.name);
    console.log("=".repeat(80));
    console.log(row.create_table_query);
  }

  // Also check what this view produces for niggemon
  console.log("\n" + "=".repeat(80));
  console.log("SAMPLE DATA FROM realized_pnl_by_market_v2 FOR NIGGEMON");
  console.log("=".repeat(80));

  const query2 = `
    SELECT
      wallet,
      market_id,
      realized_pnl_usd,
      fill_count
    FROM realized_pnl_by_market_v2
    WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
    ORDER BY ABS(realized_pnl_usd) DESC
    LIMIT 10
  `;

  const result2 = await clickhouse.query({ query: query2, format: 'JSONEachRow' });
  const data2 = await result2.json();

  for (const row of data2 as any[]) {
    console.log("Market: " + row.market_id + " | Fills: " + row.fill_count + " | P&L: $" + row.realized_pnl_usd);
  }

  // Count total rows
  const query3 = `
    SELECT COUNT(*) as row_count, SUM(realized_pnl_usd) as total_pnl
    FROM realized_pnl_by_market_v2
    WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  `;

  const result3 = await clickhouse.query({ query: query3, format: 'JSONEachRow' });
  const data3 = await result3.json() as any[];

  console.log("\n" + "=".repeat(80));
  console.log("TOTALS FROM realized_pnl_by_market_v2");
  console.log("=".repeat(80));
  console.log("Total markets: " + data3[0].row_count);
  console.log("Total P&L: $" + data3[0].total_pnl);
}

investigateBaseView().catch(console.error);
