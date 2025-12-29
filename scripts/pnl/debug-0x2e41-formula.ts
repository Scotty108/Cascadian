/**
 * Debug script to understand why 0x2e41 wallet has 92% error
 * UI PnL: $14,049.01
 * V12 Realized: $27,048.35
 */

import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000,
});

const WALLET = "0x2e41d5e1de9a072d73fd30eef9df55396270f050";

async function main() {
  console.log("=== Debug 0x2e41 Wallet: V12 vs UI discrepancy ===");
  console.log("UI PnL: $14,049.01 (tooltip verified: Gain $14,062.33 - Loss $13.32)");
  console.log("V12 Realized: $27,048.35");
  console.log("Error: 92.5%");
  console.log("");

  // 1. Compare V12 query path counts
  console.log("=== V12 Query Path (pm_trader_events_v2 -> mapping -> resolutions) ===");
  const v12Query = `
    SELECT
      count() as total_events,
      countDistinct(te.token_id) as unique_tokens,
      countDistinct(map.condition_id) as unique_conditions,
      countIf(map.condition_id IS NOT NULL) as mapped_events,
      countIf(res.payout_numerators IS NOT NULL AND res.payout_numerators != '') as resolved_events,
      round(sum(usdc_delta), 2) as total_usdc_delta,
      round(sum(token_delta), 2) as total_token_delta
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0 AND role = 'maker'
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
  `;
  const v12Result = await ch.query({ query: v12Query, query_params: { wallet: WALLET }, format: "JSONEachRow" });
  console.log(await v12Result.json());

  // 2. Unified ledger counts
  console.log("\n=== Unified Ledger V8 (has payout_norm precomputed) ===");
  const ledgerQuery = `
    SELECT
      count() as total_events,
      countDistinct(condition_id) as unique_conditions,
      countIf(payout_norm IS NOT NULL AND payout_norm > 0) as has_payout_events,
      countIf(payout_norm IS NULL OR payout_norm = 0) as no_payout_events,
      round(sum(usdc_delta), 2) as total_usdc_delta,
      round(sum(token_delta), 2) as total_token_delta
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower({wallet:String})
  `;
  const ledgerResult = await ch.query({ query: ledgerQuery, query_params: { wallet: WALLET }, format: "JSONEachRow" });
  console.log(await ledgerResult.json());

  // 3. What conditions in unified ledger have NULL payout?
  console.log("\n=== Conditions with NULL/0 payout in Unified Ledger ===");
  const nullPayoutQuery = `
    SELECT
      condition_id,
      count() as events,
      any(payout_norm) as payout_norm,
      round(sum(usdc_delta), 2) as total_usdc,
      round(sum(token_delta), 2) as total_tokens
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower({wallet:String})
      AND (payout_norm IS NULL OR payout_norm = 0)
    GROUP BY condition_id
    ORDER BY total_usdc
    LIMIT 10
  `;
  const nullPayoutResult = await ch.query({ query: nullPayoutQuery, query_params: { wallet: WALLET }, format: "JSONEachRow" });
  const nullConditions = await nullPayoutResult.json() as any[];
  console.log(nullConditions);

  // 4. Check if these conditions exist in pm_condition_resolutions
  if (nullConditions.length > 0) {
    console.log("\n=== These conditions in pm_condition_resolutions ===");
    for (const c of nullConditions.slice(0, 5)) {
      const checkQuery = `
        SELECT
          condition_id,
          payout_numerators,
          length(payout_numerators) as len
        FROM pm_condition_resolutions
        WHERE condition_id = {condId:String}
      `;
      const checkResult = await ch.query({
        query: checkQuery,
        query_params: { condId: c.condition_id },
        format: "JSONEachRow"
      });
      const rows = await checkResult.json();
      console.log(`${c.condition_id.slice(0, 20)}... | ledger payout: ${c.payout_norm} | resolution table:`, rows);
    }
  }

  // 5. Calculate V12 formula manually step by step
  console.log("\n=== V12 Formula Step by Step (maker only) ===");
  const formulaQuery = `
    SELECT
      round(sum(usdc_delta), 2) as cash_flow,
      round(sum(token_delta), 2) as tokens_held,
      round(sum(
        token_delta * if(
          JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000,
          1.0,
          toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1))
        )
      ), 2) as token_payout_value,
      round(sum(usdc_delta) + sum(
        token_delta * if(
          JSONExtractInt(res.payout_numerators, map.outcome_index + 1) >= 1000,
          1.0,
          toFloat64(JSONExtractInt(res.payout_numerators, map.outcome_index + 1))
        )
      ), 2) as realized_pnl
    FROM (
      SELECT
        event_id,
        argMax(token_id, trade_time) as token_id,
        argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
        argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String} AND is_deleted = 0 AND role = 'maker'
      GROUP BY event_id
    ) AS te
    LEFT JOIN pm_token_to_condition_map_v5 AS map ON te.token_id = map.token_id_dec
    LEFT JOIN pm_condition_resolutions AS res ON map.condition_id = res.condition_id
    WHERE res.payout_numerators IS NOT NULL AND res.payout_numerators != ''
  `;
  const formulaResult = await ch.query({ query: formulaQuery, query_params: { wallet: WALLET }, format: "JSONEachRow" });
  console.log(await formulaResult.json());

  // 6. Compare with Polymarket's apparent formula
  console.log("\n=== What Polymarket UI might be showing ===");
  console.log("UI Gain: $14,062.33");
  console.log("UI Loss: $13.32");
  console.log("Net: $14,049.01");
  console.log("");
  console.log("V12 Realized: $27,048.35");
  console.log("Difference: $" + (27048.35 - 14049.01).toFixed(2));
  console.log("");
  console.log("HYPOTHESIS: V12 is double-counting something, or including taker trades that UI excludes");

  await ch.close();
}

main().catch(console.error);
