#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 200)}`);
    return [];
  }
}

const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

async function main() {
  console.log("\n🔍 Finding the correct join key between trades_raw and winning_index\n");

  // CHECK 1: Sample condition_id from trades_raw
  console.log("1️⃣  Sample condition_id values from trades_raw:\n");
  try {
    const data = await queryData(`
      SELECT DISTINCT condition_id
      FROM trades_raw
      WHERE lower(wallet_address) = '${wallet1}'
      LIMIT 5
    `);
    console.log(JSON.stringify(data, null, 2));
    console.log();
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}`);
  }

  // CHECK 2: Sample condition_id_norm from winning_index
  console.log("\n2️⃣  Sample condition_id_norm values from winning_index:\n");
  try {
    const data = await queryData(`
      SELECT DISTINCT condition_id_norm
      FROM winning_index
      LIMIT 5
    `);
    console.log(JSON.stringify(data, null, 2));
    console.log();
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}`);
  }

  // CHECK 3: Check if condition_id from trades matches condition_id_norm
  console.log("\n3️⃣  Check if condition_id from trades_raw directly matches condition_id_norm:\n");
  try {
    const data = await queryData(`
      SELECT
        count() as matches,
        count(DISTINCT t.condition_id) as unique_trades_conditions
      FROM trades_raw t
      INNER JOIN winning_index w ON t.condition_id = w.condition_id_norm
      WHERE lower(t.wallet_address) = '${wallet1}'
    `);
    console.log(JSON.stringify(data, null, 2));
    console.log();
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}`);
  }

  // CHECK 4: Check resolutions_norm table (which winning_index pulls from)
  console.log("\n4️⃣  Check if there's a resolutions_norm table we can join through:\n");
  try {
    const schema = await queryData(`SHOW CREATE TABLE resolutions_norm`);
    if (schema && schema.length > 0) {
      console.log(schema[0].statement);
    } else {
      console.log("  resolutions_norm table not found");
    }
    console.log();
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}`);
  }

  // CHECK 5: Check market_outcomes_expanded
  console.log("\n5️⃣  Check market_outcomes_expanded structure:\n");
  try {
    const schema = await queryData(`SHOW CREATE TABLE market_outcomes_expanded`);
    if (schema && schema.length > 0) {
      console.log(schema[0].statement);
    } else {
      console.log("  market_outcomes_expanded table not found");
    }
    console.log();
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}`);
  }

  // CHECK 6: Look for a canonical_condition or market_resolutions table
  console.log("\n6️⃣  Check market_resolutions_final:\n");
  try {
    const schema = await queryData(`SHOW CREATE TABLE market_resolutions_final`);
    if (schema && schema.length > 0) {
      console.log(schema[0].statement);
    } else {
      console.log("  market_resolutions_final table not found");
    }
    console.log();
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}`);
  }

  // CHECK 7: Try computing P&L with what we have
  console.log("\n7️⃣  ATTEMPT: Compute realized P&L directly joining trades_raw to winning_index:\n");
  try {
    const data = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count(DISTINCT t.trade_id) as num_trades,
        round(sum(
          CASE
            WHEN t.outcome_index = toInt64(w.win_idx) THEN
              -- Winning outcome: get full settlement
              CASE
                WHEN t.side = 1 THEN t.shares  -- Long: +shares
                WHEN t.side = 2 THEN -t.shares -- Short: -shares (but both get $1)
                ELSE 0
              END
            WHEN t.outcome_index != toInt64(w.win_idx) THEN
              -- Losing outcome: $0
              0
            ELSE 0
          END
        ), 2) AS settlement_usd,
        round(sum(
          CASE
            WHEN t.side = 1 THEN -t.entry_price * t.shares
            WHEN t.side = 2 THEN t.entry_price * t.shares
            ELSE 0
          END
        ), 2) AS cashflow_usd,
        round(sum(COALESCE(t.fee_usd, 0) + COALESCE(t.slippage_usd, 0)), 2) AS fees_usd
      FROM trades_raw t
      INNER JOIN winning_index w ON t.condition_id = w.condition_id_norm
      WHERE lower(t.wallet_address) = '${wallet1}'
      GROUP BY wallet
    `);

    for (const row of data) {
      const net = parseFloat(row.settlement_usd || 0) + parseFloat(row.cashflow_usd || 0) - parseFloat(row.fees_usd || 0);
      console.log(`  Wallet: ${row.wallet.substring(0, 12)}...`);
      console.log(`    Trades in resolved conditions: ${row.num_trades}`);
      console.log(`    Settlement: $${row.settlement_usd}`);
      console.log(`    Cashflow: $${row.cashflow_usd}`);
      console.log(`    Fees: $${row.fees_usd}`);
      console.log(`    Realized P&L: $${net.toFixed(2)}`);
      console.log(`    Expected: $89,975.16`);
      console.log(`    Variance: ${(((net - 89975.16) / 89975.16 * 100).toFixed(2))}%\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 200)}`);
  }
}

main().catch(console.error);
