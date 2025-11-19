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
  console.log("ANALYZING DATA COMPOSITION FOR niggemon");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";

  try {
    const result = await ch.query({
      query: `
        SELECT
          'TRADES STATISTICS' as metric,
          toString(count()) as value
        FROM trade_flows_v2
        WHERE lower(wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'TRADES WITH WINNERS' as metric,
          toString(countIf(wi.win_idx IS NOT NULL)) as value
        FROM trade_flows_v2 AS tf
        LEFT JOIN winning_index AS wi ON wi.condition_id_norm = tf.condition_id_norm
        WHERE lower(tf.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'UNIQUE CONDITIONS' as metric,
          toString(count(DISTINCT condition_id_norm)) as value
        FROM trade_flows_v2
        WHERE lower(wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'CASHFLOWS (ALL)' as metric,
          round(sum(toFloat64(cashflow_usdc)), 2)
        FROM trade_flows_v2
        WHERE lower(wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'CASHFLOWS (RESOLVED ONLY)' as metric,
          round(sum(toFloat64(tf.cashflow_usdc)), 2)
        FROM trade_flows_v2 AS tf
        LEFT JOIN winning_index AS wi ON wi.condition_id_norm = tf.condition_id_norm
        WHERE wi.win_idx IS NOT NULL AND lower(tf.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'DELTA_SHARES (WINNING TRADE_IDX +1)' as metric,
          round(sumIf(toFloat64(delta_shares), coalesce(trade_idx, 0) = toInt16(wi.win_idx) + 1), 2)
        FROM trade_flows_v2 AS tf
        LEFT JOIN winning_index AS wi ON wi.condition_id_norm = tf.condition_id_norm
        WHERE wi.win_idx IS NOT NULL AND lower(tf.wallet) = lower('${niggemon}')
        
        UNION ALL
        
        SELECT
          'DELTA_SHARES (EXACT MATCH)' as metric,
          round(sumIf(toFloat64(delta_shares), coalesce(trade_idx, 0) = toInt16(wi.win_idx)), 2)
        FROM trade_flows_v2 AS tf
        LEFT JOIN winning_index AS wi ON wi.condition_id_norm = tf.condition_id_norm
        WHERE wi.win_idx IS NOT NULL AND lower(tf.wallet) = lower('${niggemon}')
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Data Composition Analysis:");
    console.log("─".repeat(70));
    for (const row of data) {
      const metric = row[0];
      const value = row[1];
      console.log(`${metric.padEnd(40)}: ${value}`);
    }

    console.log("\nExpected Results:");
    console.log("─".repeat(70));
    console.log(`niggemon: $102,001.00`);

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
