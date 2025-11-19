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
  console.log("DIAGNOSTIC: What does trade_idx represent?");
  console.log("════════════════════════════════════════════════════════════════\n");

  try {
    // Get a sample condition with multiple outcome indices
    const result = await ch.query({
      query: `
        SELECT
          t.market_id,
          t.outcome,
          t.outcome_index,
          count() as cnt
        FROM trades_raw t
        WHERE market_id NOT IN ('12', '0x0000000000000000000000000000000000000000000000000000000000000000')
        GROUP BY t.market_id, t.outcome, t.outcome_index
        HAVING count() >= 5
        ORDER BY count() DESC
        LIMIT 1
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data[0];

    if (data) {
      const market_id = data[0];
      const outcome = data[1];
      const outcome_idx = data[2];

      console.log(`Sample: market_id=${market_id.substring(0,16)}...`);
      console.log(`        outcome="${outcome}" (outcome_index=${outcome_idx})`);
      console.log();

      // Now check what trade_idx is in trade_flows_v2 for this market
      const tf_result = await ch.query({
        query: `
          SELECT DISTINCT
            tf.trade_idx,
            tf.outcome_raw
          FROM trade_flows_v2 tf
          WHERE lower(tf.market_id) = lower('${market_id}')
          ORDER BY tf.trade_idx
        `,
        format: "JSONCompact"
      });

      const tf_text = await tf_result.text();
      const tf_data = JSON.parse(tf_text).data || [];

      console.log("Values in trade_flows_v2 for this market:");
      for (const row of tf_data) {
        console.log(`  trade_idx=${row[0]} → outcome_raw="${row[1]}"`);
      }
      console.log();

      // Check gamma_markets for outcome array
      const gm_result = await ch.query({
        query: `
          SELECT
            outcomes
          FROM gamma_markets
          WHERE lower(market_id) = lower('${market_id}')
          LIMIT 1
        `,
        format: "JSONCompact"
      });

      const gm_text = await gm_result.text();
      const gm_data = JSON.parse(gm_text).data[0];

      if (gm_data && gm_data[0]) {
        const outcomes = gm_data[0];
        console.log("Outcome array from gamma_markets:");
        console.log(`  ${JSON.stringify(outcomes)}`);
        console.log();

        // Analyze ClickHouse indexing
        console.log("ClickHouse array indexing (1-based):");
        if (Array.isArray(outcomes)) {
          for (let i = 0; i < outcomes.length; i++) {
            console.log(`  arrayElement(outcomes, ${i + 1}) = "${outcomes[i]}" (0-based idx=${i})`);
          }
        }
      }

      // CRITICAL: Check if trade_idx matches outcome_index from trades_raw
      console.log("\n════════════════════════════════════════════════════════════════");
      console.log("HYPOTHESIS TEST: Does trade_idx = outcome_index from trades_raw?");
      console.log("════════════════════════════════════════════════════════════════\n");

      const comparison = await ch.query({
        query: `
          SELECT
            t.outcome_index as raw_outcome_idx,
            tf.trade_idx as trade_flows_idx,
            CASE WHEN t.outcome_index = tf.trade_idx THEN 'MATCH' ELSE 'MISMATCH' END as result,
            count() as cnt
          FROM trades_raw t
          JOIN trade_flows_v2 tf ON lower(t.market_id) = lower(tf.market_id)
                                   AND lower(t.wallet_address) = lower(tf.wallet)
                                   AND t.entry_price = tf.cashflow_usdc
          WHERE lower(t.market_id) = lower('${market_id}')
          GROUP BY t.outcome_index, tf.trade_idx
          ORDER BY t.outcome_index, tf.trade_idx
        `,
        format: "JSONCompact"
      });

      const comp_text = await comparison.text();
      const comp_data = JSON.parse(comp_text).data || [];

      for (const row of comp_data) {
        console.log(`raw_outcome_idx=${row[0]} vs trade_idx=${row[1]} → ${row[2]} (count=${row[3]})`);
      }
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
