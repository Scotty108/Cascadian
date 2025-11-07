#!/usr/bin/env npx tsx
/**
 * Delta Probes A/B/C - Variance Analysis
 * If Step 7 results don't match targets, these probes isolate the cause
 * - Probe A: Fees impact
 * - Probe B: Snapshot sensitivity
 * - Probe C: Coverage/resolved conditions
 */
import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

const WALLETS = {
  HolyMoses7: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
  niggemon: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0"
};

const SNAPSHOT = "2025-10-31 23:59:59";

async function main() {
  console.log("════════════════════════════════════════════════════════");
  console.log("DELTA PROBES A/B/C - Variance Analysis");
  console.log("════════════════════════════════════════════════════════\n");

  // Probe A: Fees impact
  console.log("PROBE A: Fees Impact Analysis");
  console.log("─────────────────────────────────────────────────────────");
  console.log("Compares: PnL with fees vs without fees\n");

  try {
    const fees_result = await ch.query({
      query: `
        SELECT
          wallet,
          round(sum(realized_pnl_usd), 2) as pnl_with_fees,
          round(sum(settlement_usd + signed_cashflow_no_fees), 2) as pnl_without_fees,
          round(pnl_with_fees - pnl_without_fees, 2) as fee_impact
        FROM (
          SELECT
            wallet_address as wallet,
            sum(settlement_usd - signed_cashflow) as realized_pnl_usd,
            sum(settlement_usd) as settlement_usd,
            sum(signed_cashflow_with_fees) as signed_cashflow_no_fees
          FROM (
            SELECT
              t.wallet_address,
              ANY(mr.winning_index) as winning_idx,
              sum(case
                when toString(t.side) = 'BUY' then -1 else 1
              end * t.price * abs(t.shares)) as signed_cashflow,
              (case
                when toString(t.side) = 'BUY' then -1 else 1
              end * t.price * abs(t.shares)) - coalesce(t.fee_usd, 0) - coalesce(t.slippage_usd, 0) as signed_cashflow_with_fees,
              sum(case
                when (toString(t.side) = 'BUY' and outcome_index = winning_idx)
                  or (toString(t.side) = 'SELL' and outcome_index != winning_idx)
                  then abs(t.shares) else 0
                end) as settlement_usd
            FROM trades_raw t
            LEFT JOIN market_resolutions_final mr ON lower(replaceAll(t.condition_id, '0x', '')) = mr.condition_id_norm
            WHERE t.wallet_address IN ('${Object.values(WALLETS).join("','")}')
              AND t.block_time <= toDateTime('${SNAPSHOT}')
              AND mr.winning_outcome IS NOT NULL
            GROUP BY t.wallet_address, t.market_id, mr.condition_id_norm
          )
          GROUP BY wallet_address
        )
        GROUP BY wallet
      `,
      format: "TabSeparated"
    });
    const fees_text = await fees_result.text();
    console.log("Wallet\t\tWith Fees\tWithout Fees\tFee Impact");
    console.log(fees_text);
  } catch (error: any) {
    console.error("❌ Probe A Error:", error.message);
  }

  console.log("\n");

  // Probe B: Snapshot sensitivity
  console.log("PROBE B: Snapshot Sensitivity Analysis");
  console.log("─────────────────────────────────────────────────────────");
  console.log("Compares: PnL at different snapshot dates\n");

  const snapshots = [
    "2025-10-24 23:59:59",
    "2025-10-31 23:59:59",
    "2025-11-07 23:59:59"
  ];

  for (const snapshot of snapshots) {
    console.log(`Snapshot: ${snapshot}`);
    try {
      const snap_result = await ch.query({
        query: `
          SELECT
            wallet_address as wallet,
            round(sum(realized_pnl), 2) as realized_pnl
          FROM (
            SELECT
              t.wallet_address,
              ANY(mr.winning_index) as winning_idx,
              sum(case
                when (toString(t.side) = 'BUY' and outcome_index = winning_idx)
                  or (toString(t.side) = 'SELL' and outcome_index != winning_idx)
                  then abs(t.shares) else 0
                end) -
              sum(case
                when toString(t.side) = 'BUY' then -1 else 1
              end * t.price * abs(t.shares) + coalesce(t.fee_usd, 0) + coalesce(t.slippage_usd, 0)) as realized_pnl
            FROM trades_raw t
            LEFT JOIN market_resolutions_final mr ON lower(replaceAll(t.condition_id, '0x', '')) = mr.condition_id_norm
            WHERE t.wallet_address IN ('${Object.values(WALLETS).join("','")}')
              AND t.block_time <= toDateTime('${snapshot}')
              AND mr.resolved_at <= toDateTime('${snapshot}')
              AND mr.winning_outcome IS NOT NULL
            GROUP BY t.wallet_address, t.market_id, mr.condition_id_norm
          )
          GROUP BY wallet_address
        `,
        format: "TabSeparated"
      });
      const snap_text = await snap_result.text();
      console.log(snap_text);
    } catch (error: any) {
      console.error("  ❌ Error:", error.message);
    }
  }

  console.log("\n");

  // Probe C: Coverage analysis
  console.log("PROBE C: Coverage Analysis");
  console.log("─────────────────────────────────────────────────────────");
  console.log("Reports: Traded markets vs resolved markets\n");

  for (const [name, wallet] of Object.entries(WALLETS)) {
    console.log(`${name}:`);
    try {
      const coverage_result = await ch.query({
        query: `
          SELECT
            count(DISTINCT t.market_id) as traded_markets,
            sum(if(mr.winning_outcome IS NOT NULL, 1, 0)) as resolved_positions,
            count(DISTINCT mr.condition_id_norm) as resolved_markets,
            traded_markets - resolved_markets as missing_resolved
          FROM trades_raw t
          LEFT JOIN market_resolutions_final mr ON lower(replaceAll(t.condition_id, '0x', '')) = mr.condition_id_norm
          WHERE t.wallet_address = '${wallet}'
        `,
        format: "TabSeparated"
      });
      const cov_text = await coverage_result.text();
      console.log(cov_text);

      // List 5 missing markets
      console.log("  Sample missing markets:");
      const missing_result = await ch.query({
        query: `
          SELECT DISTINCT
            t.market_id,
            lower(replaceAll(t.condition_id, '0x', '')) as condition_normalized,
            if(mr.condition_id_norm IS NULL, 'NO_RESOLUTION', 'HAS_RESOLUTION') as status
          FROM trades_raw t
          LEFT JOIN market_resolutions_final mr ON lower(replaceAll(t.condition_id, '0x', '')) = mr.condition_id_norm
          WHERE t.wallet_address = '${wallet}'
            AND mr.condition_id_norm IS NULL
          LIMIT 5
        `,
        format: "TabSeparated"
      });
      const missing_text = await missing_result.text();
      console.log(missing_text);
    } catch (error: any) {
      console.error("  ❌ Error:", error.message);
    }
  }

  console.log("\n════════════════════════════════════════════════════════");
  console.log("✅ Delta Probes complete");
  process.exit(0);
}

main();
