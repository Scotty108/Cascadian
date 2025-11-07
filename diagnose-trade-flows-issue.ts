#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("ROOT CAUSE: Diagnosing trade_flows_v2 overcounting");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Check 1: Compare trades_raw vs trade_flows_v2 row count
  console.log("CHECK 1: Row count comparison");
  console.log("─".repeat(70));
  
  try {
    const tr_result = await ch.query({
      query: `
        SELECT count() as trades_raw_rows
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const tf_result = await ch.query({
      query: `
        SELECT count() as trade_flows_rows
        FROM trade_flows_v2
        WHERE lower(wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const tr_text = await tr_result.text();
    const tr_data = JSON.parse(tr_text).data[0];
    
    const tf_text = await tf_result.text();
    const tf_data = JSON.parse(tf_text).data[0];

    const tr_rows = tr_data[0];
    const tf_rows = tf_data[0];

    console.log(`trades_raw:     ${tr_rows}`);
    console.log(`trade_flows_v2: ${tf_rows}`);
    console.log(`Ratio:          ${(tf_rows / tr_rows).toFixed(2)}x\n`);

    if (tf_rows > tr_rows) {
      console.log(`❌ ISSUE FOUND: trade_flows_v2 has ${tf_rows - tr_rows} more rows than trades_raw!\n`);
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Check 2: Look at one market's data in both tables
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECK 2: Sample market comparison (trades_raw vs trade_flows_v2)");
  console.log("─".repeat(70));

  try {
    // Get a sample market for niggemon
    const sample_result = await ch.query({
      query: `
        SELECT market_id
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${niggemon}')
        LIMIT 1
      `,
      format: "JSONCompact"
    });

    const sample_text = await sample_result.text();
    const sample_data = JSON.parse(sample_text).data[0];
    const sample_market = sample_data[0];

    console.log(`Sample market_id: ${sample_market}\n`);

    // Now check this market in both tables
    const tr_sample = await ch.query({
      query: `
        SELECT
          wallet_address,
          market_id,
          timestamp,
          entry_price,
          shares,
          outcome,
          count() as occurrences
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${niggemon}')
          AND market_id = '${sample_market}'
        GROUP BY wallet_address, market_id, timestamp, entry_price, shares, outcome
        HAVING count() > 1
      `,
      format: "JSONCompact"
    });

    const tr_dup_text = await tr_sample.text();
    const tr_dup_data = JSON.parse(tr_dup_text).data;

    if (tr_dup_data.length > 0) {
      console.log("⚠️  DUPLICATE TRADES FOUND IN trades_raw:");
      for (const row of tr_dup_data) {
        console.log(`  Market: ${row[1]} | Outcome: ${row[5]} | Count: ${row[6]}`);
      }
      console.log();
    } else {
      console.log("✅ No duplicates in trades_raw for this market\n");
    }

    // Check trade_flows_v2 for same market
    const tf_sample = await ch.query({
      query: `
        SELECT
          count() as tf_rows,
          sum(CAST(cashflow_usdc AS Float64)) as total_cashflow,
          sum(CAST(delta_shares AS Float64)) as total_shares,
          uniq(condition_id_norm) as unique_conditions
        FROM trade_flows_v2
        WHERE lower(wallet) = lower('${niggemon}')
          AND market_id = '${sample_market}'
      `,
      format: "JSONCompact"
    });

    const tf_sample_text = await tf_sample.text();
    const tf_sample_data = JSON.parse(tf_sample_text).data[0];

    console.log("In trade_flows_v2 for this market:");
    console.log(`  Rows: ${tf_sample_data[0]}`);
    console.log(`  Total cashflows: ${tf_sample_data[1]}`);
    console.log(`  Total shares: ${tf_sample_data[2]}`);
    console.log(`  Unique conditions: ${tf_sample_data[3]}\n`);

  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  // Check 3: Verify the trade_flows_v2 definition
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("CHECK 3: trade_flows_v2 definition");
  console.log("─".repeat(70));

  try {
    const def_result = await ch.query({
      query: `
        SELECT create_table_query
        FROM system.tables
        WHERE database = 'default' AND name = 'trade_flows_v2'
      `,
      format: "JSONCompact"
    });

    const def_text = await def_result.text();
    const def_data = JSON.parse(def_text).data[0];
    
    if (def_data) {
      const query = def_data[0];
      console.log(query.substring(0, 1000));
      console.log("\n...(truncated)\n");
    }
  } catch (e: any) {
    console.log(`Error: ${e.message}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
