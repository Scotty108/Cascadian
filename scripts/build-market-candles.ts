#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("BUILDING 5-MINUTE MARKET CANDLES FOR PRICE CHARTS");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create candles table
    console.log("Creating market_candles_5m table...");
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS market_candles_5m (
          market_id String,
          bucket DateTime,
          open String,
          high String,
          low String,
          close String,
          volume String,
          notional String,
          vwap String
        )
        ENGINE = ReplacingMergeTree()
        ORDER BY (market_id, bucket)
      `,
    });
    console.log("✅ Table created\n");

    // Backfill candles from existing fills (trades_raw is the source of truth)
    console.log("Backfilling candles from trades_raw (verified source of truth)...");
    await ch.exec({
      query: `
        INSERT INTO market_candles_5m
        SELECT
          market_id,
          toStartOfInterval(timestamp, INTERVAL 5 minute) AS bucket,
          toString(argMin(entry_price, timestamp)) AS open,
          toString(max(entry_price)) AS high,
          toString(min(entry_price)) AS low,
          toString(argMax(entry_price, timestamp)) AS close,
          toString(sum(shares)) AS volume,
          toString(sum(entry_price * CAST(shares AS Float64))) AS notional,
          toString(sum(entry_price * CAST(shares AS Float64)) / NULLIF(sum(CAST(shares AS Float64)), 0)) AS vwap
        FROM trades_raw
        GROUP BY market_id, bucket
      `,
    });
    console.log("✅ Candles backfilled from trades_raw\n");

    // Health check: candle count
    console.log("Health check: Candle coverage\n");
    const countQ = await ch.query({
      query: `
        SELECT
          COUNT(*) AS total_buckets,
          COUNT(DISTINCT market_id) AS markets,
          COUNT(DISTINCT toDate(bucket)) AS days
        FROM market_candles_5m
      `,
    });

    const countText = await countQ.text();
    const countData = JSON.parse(countText);
    const stats = countData.data ? countData.data[0] : {};

    console.log(`Total candle buckets: ${stats.total_buckets}`);
    console.log(`Unique markets: ${stats.markets}`);
    console.log(`Date range: ${stats.days} days\n`);

    // Top 10 markets by bucket count
    const topQ = await ch.query({
      query: `
        SELECT market_id, count() AS buckets, toString(max(vwap)) AS latest_vwap
        FROM market_candles_5m
        GROUP BY market_id
        ORDER BY buckets DESC
        LIMIT 10
      `,
    });

    const topText = await topQ.text();
    const topData = JSON.parse(topText);

    console.log("Top 10 markets by candle count:\n");
    (topData.data || []).forEach((row: any) => {
      console.log(`  ${row.market_id.slice(0, 20)}...: ${row.buckets} buckets | VWAP: ${row.latest_vwap?.slice(0, 8)}...`);
    });

    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log("✅ MARKET CANDLES READY FOR PRICE CHARTS\n");
    console.log("Next steps:");
    console.log("  - Use market_candles_5m for price history charts");
    console.log("  - Mark positions to market using latest candle VWAP");
    console.log("  - Compute portfolio P&L from filled trades\n");

    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
