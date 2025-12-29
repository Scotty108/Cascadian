import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";

async function main() {
  // Check the suspicious wallet with 11M fills
  const suspicious = "0xc5d563a36ae78145c45a50134d48a1215220f80a";

  console.log("=== Checking suspicious wallet: " + suspicious.slice(0,10) + "... ===\n");

  const query = `
  SELECT
    count() as total_fills,
    uniq(token_id) as unique_markets,
    sum(notional) as total_notional,
    min(trade_date) as first_trade,
    max(trade_date) as last_trade,
    avg(notional) as avg_notional_per_fill
  FROM markout_14d_fills
  WHERE wallet = '${suspicious}'
  `;

  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const rows = await result.json() as any[];
  console.log("Stats:", rows[0]);

  // Check daily trading volume
  const dailyQuery = `
  SELECT
    trade_date,
    count() as fills,
    round(sum(notional)) as notional
  FROM markout_14d_fills
  WHERE wallet = '${suspicious}'
  GROUP BY trade_date
  ORDER BY trade_date DESC
  LIMIT 10
  `;

  console.log("\nRecent daily activity:");
  const dailyResult = await clickhouse.query({ query: dailyQuery, format: "JSONEachRow" });
  for await (const row of dailyResult.stream()) {
    console.log(row);
  }

  // Check if they're mostly small trades
  const sizeQuery = `
  SELECT
    CASE
      WHEN notional < 1 THEN '<$1'
      WHEN notional < 10 THEN '$1-$10'
      WHEN notional < 100 THEN '$10-$100'
      WHEN notional < 1000 THEN '$100-$1k'
      ELSE '>$1k'
    END as size_bucket,
    count() as fills,
    round(sum(notional)) as total_notional
  FROM markout_14d_fills
  WHERE wallet = '${suspicious}'
  GROUP BY size_bucket
  ORDER BY fills DESC
  `;

  console.log("\nTrade size distribution:");
  const sizeResult = await clickhouse.query({ query: sizeQuery, format: "JSONEachRow" });
  for await (const row of sizeResult.stream()) {
    console.log(row);
  }

  // Now check a "clean" looking top wallet
  console.log("\n\n=== Checking clean wallet: 0xd04d6311... ===\n");
  const clean = "0xd04d631183d7568356f598a3c77181ec4ab6d0e5";

  const cleanQuery = `
  SELECT
    count() as total_fills,
    uniq(token_id) as unique_markets,
    sum(notional) as total_notional,
    min(trade_date) as first_trade,
    max(trade_date) as last_trade,
    avg(notional) as avg_notional_per_fill
  FROM markout_14d_fills
  WHERE wallet = '${clean}'
  `;

  const cleanResult = await clickhouse.query({ query: cleanQuery, format: "JSONEachRow" });
  const cleanRows = await cleanResult.json() as any[];
  console.log("Stats:", cleanRows[0]);

  // Size distribution for clean wallet
  const cleanSizeQuery = sizeQuery.replace(suspicious, clean);
  console.log("\nTrade size distribution:");
  const cleanSizeResult = await clickhouse.query({
    query: cleanSizeQuery,
    format: "JSONEachRow"
  });
  for await (const row of cleanSizeResult.stream()) {
    console.log(row);
  }
}

main().catch(console.error);
