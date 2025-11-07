import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client';

config({ path: '.env.local' });

async function investigateCashflows() {
  console.log("=".repeat(80));
  console.log("INVESTIGATING trade_cashflows_v3 TABLE");
  console.log("=".repeat(80));

  // Get table definition
  const query1 = `
    SELECT create_table_query
    FROM system.tables
    WHERE database = currentDatabase()
    AND name = 'trade_cashflows_v3'
  `;

  const result1 = await clickhouse.query({ query: query1, format: 'JSONEachRow' });
  const data1 = await result1.json();

  if ((data1 as any[]).length > 0) {
    console.log("\nTABLE DEFINITION:");
    console.log((data1 as any[])[0].create_table_query);
  }

  // Count rows for niggemon
  const query2 = `
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT condition_id_norm) as unique_conditions,
      SUM(cashflow_usdc) as total_cashflow
    FROM trade_cashflows_v3
    WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
  `;

  const result2 = await clickhouse.query({ query: query2, format: 'JSONEachRow' });
  const data2 = await result2.json();

  console.log("\n" + "=".repeat(80));
  console.log("CASHFLOWS DATA FOR NIGGEMON");
  console.log("=".repeat(80));
  console.log("Total cashflow rows: " + (data2 as any[])[0].total_rows);
  console.log("Unique conditions: " + (data2 as any[])[0].unique_conditions);
  console.log("Sum of cashflows: $" + (data2 as any[])[0].total_cashflow);

  // Sample rows
  const query3 = `
    SELECT *
    FROM trade_cashflows_v3
    WHERE wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
    LIMIT 5
  `;

  const result3 = await clickhouse.query({ query: query3, format: 'JSONEachRow' });
  const data3 = await result3.json();

  console.log("\n" + "=".repeat(80));
  console.log("SAMPLE ROWS (FIRST 5)");
  console.log("=".repeat(80));
  console.log(JSON.stringify(data3, null, 2));

  // Compare to trades_raw
  const query4 = `
    SELECT
      COUNT(*) as total_trades,
      COUNT(DISTINCT market_id) as unique_markets,
      SUM(realized_pnl_usd) as total_pnl
    FROM trades_raw
    WHERE lower(wallet_address) = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
    AND is_resolved = 1
  `;

  const result4 = await clickhouse.query({ query: query4, format: 'JSONEachRow' });
  const data4 = await result4.json();

  console.log("\n" + "=".repeat(80));
  console.log("COMPARISON TO trades_raw");
  console.log("=".repeat(80));
  console.log("trades_raw resolved trades: " + (data4 as any[])[0].total_trades);
  console.log("trades_raw unique markets: " + (data4 as any[])[0].unique_markets);
  console.log("trades_raw total P&L: $" + (data4 as any[])[0].total_pnl);
  console.log("\nRatio of cashflow rows to trades: " + (Number((data2 as any[])[0].total_rows) / Number((data4 as any[])[0].total_trades)).toFixed(2) + "x");
  console.log("P&L inflation ratio: " + ((data2 as any[])[0].total_cashflow / (data4 as any[])[0].total_pnl).toFixed(2) + "x");
}

investigateCashflows().catch(console.error);
