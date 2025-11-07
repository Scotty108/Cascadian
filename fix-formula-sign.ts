#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function executeQuery(query: string, name: string) {
  try {
    await ch.command({ query });
    console.log(`  ✅ ${name}`);
    return true;
  } catch (e: any) {
    const errMsg = e.message.split('\n')[0];
    console.error(`  ❌ ${name}: ${errMsg}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TESTING ALTERNATIVE FORMULA SIGNS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  // Test different formula variations
  try {
    console.log("Testing different formula variations for niggemon:\n");
    
    const result = await ch.query({
      query: `
        SELECT 
          'SUM(cf) + SUM(ds where idx)' as formula,
          round(
            sum(toFloat64(tf.cashflow_usdc)) +
            sumIf(toFloat64(tf.delta_shares), coalesce(tf.trade_idx, 0) = toInt16(wi.win_idx) + 1),
            2
          ) AS result
        FROM trade_flows_v2 AS tf
        LEFT JOIN canonical_condition AS cc ON cc.market_id = tf.market_id
        LEFT JOIN winning_index AS wi ON wi.condition_id_norm = cc.condition_id_norm
        WHERE wi.win_idx IS NOT NULL AND lower(tf.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT 
          'SUM(cf) - SUM(ds where idx)' as formula,
          round(
            sum(toFloat64(tf.cashflow_usdc)) -
            sumIf(toFloat64(tf.delta_shares), coalesce(tf.trade_idx, 0) = toInt16(wi.win_idx) + 1),
            2
          ) AS result
        FROM trade_flows_v2 AS tf
        LEFT JOIN canonical_condition AS cc ON cc.market_id = tf.market_id
        LEFT JOIN winning_index AS wi ON wi.condition_id_norm = cc.condition_id_norm
        WHERE wi.win_idx IS NOT NULL AND lower(tf.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT 
          'ABS(SUM(cf)) + ABS(SUM(ds where idx))' as formula,
          round(
            abs(sum(toFloat64(tf.cashflow_usdc))) +
            abs(sumIf(toFloat64(tf.delta_shares), coalesce(tf.trade_idx, 0) = toInt16(wi.win_idx) + 1)),
            2
          ) AS result
        FROM trade_flows_v2 AS tf
        LEFT JOIN canonical_condition AS cc ON cc.market_id = tf.market_id
        LEFT JOIN winning_index AS wi ON wi.condition_id_norm = cc.condition_id_norm
        WHERE wi.win_idx IS NOT NULL AND lower(tf.wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results:");
    console.log("─".repeat(70));
    for (const row of data) {
      const formula = row[0];
      const result = parseFloat(row[1]);
      console.log(`${formula.padEnd(40)}: $${result.toFixed(2)}`);
    }

    console.log("\nExpected: $102,001.00");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
