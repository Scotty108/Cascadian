#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function createView(sql: string, name: string) {
  try {
    await ch.command({ query: sql });
    console.log(`  ✅ ${name}`);
    return true;
  } catch (e: any) {
    const err = e.message.split('\n')[0];
    console.error(`  ❌ ${name}: ${err}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PHASE 2 STEP 3: BUILD HELPER VIEWS (OFFSET = 1)");
  console.log("════════════════════════════════════════════════════════════════\n");

  // 3.1 Winners
  console.log("3.1 Creating winners_v1...\n");
  await createView(`
    CREATE OR REPLACE VIEW winners_v1 AS
    SELECT condition_id_norm, toInt16(win_idx) AS win_idx, any(resolved_at) AS resolved_at
    FROM winning_index
    WHERE win_idx IS NOT NULL
  `, "winners_v1");

  // 3.2 Cashflows by condition (from raw flows)
  console.log("\n3.2 Creating flows_by_condition_v1...\n");
  await createView(`
    CREATE OR REPLACE VIEW flows_by_condition_v1 AS
    SELECT
      lower(tf.wallet) AS wallet,
      cc.condition_id_norm,
      sum(toFloat64(tf.cashflow_usdc)) AS cash_usd
    FROM trade_flows_v2 AS tf
    JOIN canonical_condition AS cc
      ON lower(tf.market_id) = lower(cc.market_id)
    GROUP BY wallet, cc.condition_id_norm
  `, "flows_by_condition_v1");

  // 3.3 Position shares by outcome
  console.log("\n3.3 Creating pos_by_condition_v1...\n");
  await createView(`
    CREATE OR REPLACE VIEW pos_by_condition_v1 AS
    SELECT
      lower(wallet) AS wallet,
      condition_id_norm,
      toInt16(outcome_idx) AS outcome_idx,
      sum(toFloat64(net_shares)) AS net_shares
    FROM outcome_positions_v2
    GROUP BY wallet, condition_id_norm, outcome_idx
  `, "pos_by_condition_v1");

  // 3.4 Winning shares per wallet x condition (with OFFSET = 1)
  console.log("\n3.4 Creating winning_shares_v1 (with OFFSET=1)...\n");
  await createView(`
    CREATE OR REPLACE VIEW winning_shares_v1 AS
    SELECT
      p.wallet,
      p.condition_id_norm,
      sumIf(p.net_shares, p.outcome_idx = w.win_idx + 1) AS win_shares
    FROM pos_by_condition_v1 AS p
    JOIN winners_v1 AS w USING (condition_id_norm)
    GROUP BY p.wallet, p.condition_id_norm
  `, "winning_shares_v1");

  console.log("\n" + "═".repeat(70));
  console.log("✅ ALL HELPER VIEWS CREATED");
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
