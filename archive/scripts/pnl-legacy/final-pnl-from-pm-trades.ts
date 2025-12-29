#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message?.substring(0, 200)}`);
    return [];
  }
}

const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

const expected = {
  [wallet1]: 89975.16,
  [wallet2]: 102001.46
};

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("FINAL P&L CALCULATION FROM PM_TRADES (RAW CLOB FILLS)");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Step 1: Query pm_trades for each proxy wallet
  console.log("📊 CALCULATING P&L FROM PM_TRADES\n");

  for (const [eoa, expected_val] of Object.entries(expected)) {
    // Find proxy wallets (they map to themselves based on our earlier diagnostic)
    const proxies = [eoa]; // For these wallets, they are their own proxies

    try {
      const result = await queryData(`
        WITH fills AS (
          SELECT
            market_id,
            CAST(price AS Float64) as px,
            CAST(size AS Float64) as sz,
            side,
            ts,
            -- Signed cashflow: BUY=-cost, SELL=+proceeds
            CASE
              WHEN side = 'BUY' THEN -CAST(price AS Float64) * CAST(size AS Float64)
              WHEN side = 'SELL' THEN CAST(price AS Float64) * CAST(size AS Float64)
              ELSE 0
            END AS cashflow
          FROM pm_trades
          WHERE lower(proxy_wallet) = lower('${eoa}')
        )
        SELECT
          count() as fill_count,
          countDistinct(market_id) as unique_markets,
          round(sum(cashflow), 2) as total_cashflow,
          min(ts) as first_trade,
          max(ts) as last_trade
        FROM fills
      `);

      if (result.length > 0) {
        const r = result[0];
        const cashflow = parseFloat(r.total_cashflow || 0);
        const variance = ((cashflow - expected_val) / expected_val * 100).toFixed(2);

        console.log(`  ${eoa.substring(0, 12)}...`);
        console.log(`    Fills found: ${r.fill_count}`);
        console.log(`    Unique markets: ${r.unique_markets}`);
        console.log(`    Total cashflow: $${r.total_cashflow}`);
        console.log(`    Time range: ${r.first_trade} to ${r.last_trade}`);
        console.log(`    Expected: $${expected_val.toFixed(2)}`);
        console.log(`    Variance: ${variance}%`);
        console.log(`    Status: ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      } else {
        console.log(`  ${eoa.substring(0, 12)}... - NO FILLS FOUND\n`);
      }
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
    }
  }

  // Step 2: Try including market resolutions for realized settlement
  console.log("🔍 STEP 2: Including Market Resolutions for Settlement\n");

  for (const [eoa, expected_val] of Object.entries(expected)) {
    try {
      const result = await queryData(`
        WITH fills AS (
          SELECT
            market_id,
            CAST(price AS Float64) as px,
            CAST(size AS Float64) as sz,
            side,
            ts,
            CASE
              WHEN side = 'BUY' THEN -CAST(price AS Float64) * CAST(size AS Float64)
              WHEN side = 'SELL' THEN CAST(price AS Float64) * CAST(size AS Float64)
              ELSE 0
            END AS cashflow
          FROM pm_trades
          WHERE lower(proxy_wallet) = lower('${eoa}')
        ),
        with_resolution AS (
          SELECT
            f.*,
            -- Try to find market resolution data
            multiIf(
              f.side = 'BUY', CAST(sz AS Float64),  -- Long settlement: +size if winning
              f.side = 'SELL', CAST(sz AS Float64), -- Short settlement: +size if winning
              0
            ) AS potential_settlement
          FROM fills f
        )
        SELECT
          round(sum(cashflow), 2) as total_cashflow,
          round(sum(potential_settlement), 2) as total_potential_settlement
        FROM with_resolution
      `);

      if (result.length > 0) {
        const r = result[0];
        const cashflow = parseFloat(r.total_cashflow || 0);
        const settlement = parseFloat(r.total_potential_settlement || 0);

        console.log(`  ${eoa.substring(0, 12)}...`);
        console.log(`    Cashflow: $${r.total_cashflow}`);
        console.log(`    Settlement (if all resolved): $${r.total_potential_settlement}`);
        console.log(`    Combined: $${(cashflow + settlement).toFixed(2)}\n`);
      }
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
    }
  }

  // Step 3: Get sample data to understand the structure
  console.log("🔎 STEP 3: Sample Trades from pm_trades\n");

  for (const [eoa, _] of Object.entries(expected)) {
    try {
      const result = await queryData(`
        SELECT
          market_id,
          side,
          price,
          size,
          ts,
          notional
        FROM pm_trades
        WHERE lower(proxy_wallet) = lower('${eoa}')
        ORDER BY ts DESC
        LIMIT 5
      `);

      if (result.length > 0) {
        console.log(`  ${eoa.substring(0, 12)}...`);
        for (const row of result) {
          console.log(`    ${row.side} ${row.size}@$${row.price} on ${row.market_id.substring(0, 12)}... (notional: $${row.notional})`);
        }
        console.log();
      }
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
