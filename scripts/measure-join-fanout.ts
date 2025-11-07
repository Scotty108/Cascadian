#!/usr/bin/env npx tsx

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

// Target wallets and snapshot timestamp
const TARGET_WALLETS = [
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
];
const SNAPSHOT_TS = '2025-10-31 23:59:59';
const FANOUT_GUARDRAIL = 1.001; // 0.1% max growth

interface StageResults {
  wallet: string;
  n0: number;
  n1: number;
  n2: number;
  n3: number;
  fanout_1: number;
  fanout_2: number;
  fanout_3: number;
  total_fanout: number;
  pass: boolean;
}

async function measureJoinStages(wallet: string): Promise<StageResults> {
  const walletLower = wallet.toLowerCase();

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Measuring join stages for wallet: ${wallet}`);
  console.log(`${'='.repeat(80)}\n`);

  // N0: Deduped base rows from trades_raw
  console.log("📊 Stage N0: Deduped base rows from trades_raw");
  const n0Query = `
    SELECT count() as cnt
    FROM (
      SELECT DISTINCT
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id
      FROM trades_raw
      WHERE lower(wallet_address) = '${walletLower}'
        AND timestamp <= toDateTime('${SNAPSHOT_TS}')
    )
  `;
  const n0Result = await queryData(n0Query);
  const n0 = n0Result[0]?.cnt || 0;
  console.log(`   N0 = ${n0} (deduped base rows)\n`);

  // N1: After bridge join to canonical_condition
  console.log("📊 Stage N1: After join to canonical_condition");
  const n1Query = `
    SELECT count() as cnt
    FROM (
      SELECT DISTINCT
        t.transaction_hash,
        t.wallet_address,
        t.timestamp,
        t.side,
        t.shares,
        t.entry_price,
        t.usd_value,
        t.market_id,
        c.condition_id_norm
      FROM (
        SELECT DISTINCT
          transaction_hash,
          wallet_address,
          timestamp,
          side,
          shares,
          entry_price,
          usd_value,
          market_id
        FROM trades_raw
        WHERE lower(wallet_address) = '${walletLower}'
          AND timestamp <= toDateTime('${SNAPSHOT_TS}')
      ) t
      ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
    )
  `;
  const n1Result = await queryData(n1Query);
  const n1 = n1Result[0]?.cnt || 0;
  const fanout1 = n0 > 0 ? n1 / n0 : 1;
  console.log(`   N1 = ${n1} (after canonical_condition join)`);
  console.log(`   Fanout_1 = ${fanout1.toFixed(6)} ${fanout1 <= FANOUT_GUARDRAIL ? '✅' : '❌'}\n`);

  // N2: After outcomes join to market_outcomes_expanded
  console.log("📊 Stage N2: After join to market_outcomes_expanded");
  const n2Query = `
    SELECT count() as cnt
    FROM (
      SELECT DISTINCT
        t.transaction_hash,
        t.wallet_address,
        t.timestamp,
        t.side,
        t.shares,
        t.entry_price,
        t.usd_value,
        t.market_id,
        c.condition_id_norm,
        o.outcome_idx,
        o.outcome_label
      FROM (
        SELECT DISTINCT
          transaction_hash,
          wallet_address,
          timestamp,
          side,
          shares,
          entry_price,
          usd_value,
          market_id
        FROM trades_raw
        WHERE lower(wallet_address) = '${walletLower}'
          AND timestamp <= toDateTime('${SNAPSHOT_TS}')
      ) t
      ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
      ANY LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
    )
  `;
  const n2Result = await queryData(n2Query);
  const n2 = n2Result[0]?.cnt || 0;
  const fanout2 = n1 > 0 ? n2 / n1 : 1;
  console.log(`   N2 = ${n2} (after market_outcomes_expanded join)`);
  console.log(`   Fanout_2 = ${fanout2.toFixed(6)} ${fanout2 <= FANOUT_GUARDRAIL ? '✅' : '❌'}\n`);

  // N3: After resolution join to market_resolutions_final
  console.log("📊 Stage N3: After join to market_resolutions_final");
  const n3Query = `
    SELECT count() as cnt
    FROM (
      SELECT DISTINCT
        t.transaction_hash,
        t.wallet_address,
        t.timestamp,
        t.side,
        t.shares,
        t.entry_price,
        t.usd_value,
        t.market_id,
        c.condition_id_norm,
        o.outcome_idx,
        o.outcome_label,
        r.payout_numerators,
        r.winning_outcome
      FROM (
        SELECT DISTINCT
          transaction_hash,
          wallet_address,
          timestamp,
          side,
          shares,
          entry_price,
          usd_value,
          market_id
        FROM trades_raw
        WHERE lower(wallet_address) = '${walletLower}'
          AND timestamp <= toDateTime('${SNAPSHOT_TS}')
      ) t
      ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
      ANY LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
      ANY LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
    )
  `;
  const n3Result = await queryData(n3Query);
  const n3 = n3Result[0]?.cnt || 0;
  const fanout3 = n2 > 0 ? n3 / n2 : 1;
  const totalFanout = n0 > 0 ? n3 / n0 : 1;
  console.log(`   N3 = ${n3} (after market_resolutions_final join)`);
  console.log(`   Fanout_3 = ${fanout3.toFixed(6)} ${fanout3 <= FANOUT_GUARDRAIL ? '✅' : '❌'}`);
  console.log(`   Total_fanout = ${totalFanout.toFixed(6)} ${totalFanout <= FANOUT_GUARDRAIL ? '✅' : '❌'}\n`);

  // Check if all fanouts pass
  const pass = fanout1 <= FANOUT_GUARDRAIL &&
               fanout2 <= FANOUT_GUARDRAIL &&
               fanout3 <= FANOUT_GUARDRAIL &&
               totalFanout <= FANOUT_GUARDRAIL;

  return {
    wallet,
    n0,
    n1,
    n2,
    n3,
    fanout_1: fanout1,
    fanout_2: fanout2,
    fanout_3: fanout3,
    total_fanout: totalFanout,
    pass
  };
}

async function investigateFanout(wallet: string, stage: string) {
  const walletLower = wallet.toLowerCase();
  console.log(`\n🔍 Investigating fanout at ${stage} for wallet ${wallet}`);

  if (stage === "N1") {
    // Check if any market_ids map to multiple condition_id_norms
    const fanoutQuery = `
      SELECT
        t.market_id,
        count() as trade_count,
        count(DISTINCT c.condition_id_norm) as condition_count,
        groupArray(DISTINCT c.condition_id_norm) as condition_ids
      FROM (
        SELECT DISTINCT market_id
        FROM trades_raw
        WHERE lower(wallet_address) = '${walletLower}'
          AND timestamp <= toDateTime('${SNAPSHOT_TS}')
      ) t
      LEFT JOIN canonical_condition c ON t.market_id = c.market_id
      GROUP BY t.market_id
      HAVING condition_count > 1
      LIMIT 5
    `;
    const results = await queryData(fanoutQuery);
    if (results.length > 0) {
      console.log("\n⚠️  Found markets with multiple condition_id_norms:");
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log("   No 1:many relationships found at this stage");
    }
  } else if (stage === "N2") {
    // Check if any condition_id_norms map to multiple outcomes
    const fanoutQuery = `
      SELECT
        c.condition_id_norm,
        count(DISTINCT o.outcome_idx) as outcome_count,
        groupArray(DISTINCT o.outcome_idx) as outcome_indices
      FROM (
        SELECT DISTINCT
          t.market_id,
          c.condition_id_norm
        FROM trades_raw t
        ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
        WHERE lower(t.wallet_address) = '${walletLower}'
          AND t.timestamp <= toDateTime('${SNAPSHOT_TS}')
      ) c
      LEFT JOIN market_outcomes_expanded o ON c.condition_id_norm = o.condition_id_norm
      GROUP BY c.condition_id_norm
      HAVING outcome_count > 1
      LIMIT 5
    `;
    const results = await queryData(fanoutQuery);
    if (results.length > 0) {
      console.log("\n⚠️  Found conditions with multiple outcomes:");
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log("   No 1:many relationships found at this stage");
    }
  } else if (stage === "N3") {
    // Check if any condition_id_norms map to multiple resolutions
    const fanoutQuery = `
      SELECT
        c.condition_id_norm,
        count() as resolution_count,
        groupArray(r.winning_outcome) as outcomes_array
      FROM (
        SELECT DISTINCT c.condition_id_norm
        FROM trades_raw t
        ANY LEFT JOIN canonical_condition c ON t.market_id = c.market_id
        WHERE lower(t.wallet_address) = '${walletLower}'
          AND t.timestamp <= toDateTime('${SNAPSHOT_TS}')
      ) c
      LEFT JOIN market_resolutions_final r ON c.condition_id_norm = r.condition_id_norm
      GROUP BY c.condition_id_norm
      HAVING resolution_count > 1
      LIMIT 5
    `;
    const results = await queryData(fanoutQuery);
    if (results.length > 0) {
      console.log("\n⚠️  Found conditions with multiple resolutions:");
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log("   No 1:many relationships found at this stage");
    }
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("TASK 6: JOIN FANOUT VERIFICATION AND MEASUREMENT");
  console.log("=".repeat(80));
  console.log(`\nSnapshot: ${SNAPSHOT_TS}`);
  console.log(`Fanout Guardrail: ${FANOUT_GUARDRAIL}x (max 0.1% growth)`);
  console.log(`Target Wallets: ${TARGET_WALLETS.length}`);

  const results: StageResults[] = [];

  // Measure each wallet
  for (const wallet of TARGET_WALLETS) {
    try {
      const result = await measureJoinStages(wallet);
      results.push(result);

      // If any fanout fails, investigate
      if (!result.pass) {
        console.log(`\n❌ FANOUT GUARDRAIL VIOLATED for ${wallet}`);
        if (result.fanout_1 > FANOUT_GUARDRAIL) {
          await investigateFanout(wallet, "N1");
        }
        if (result.fanout_2 > FANOUT_GUARDRAIL) {
          await investigateFanout(wallet, "N2");
        }
        if (result.fanout_3 > FANOUT_GUARDRAIL) {
          await investigateFanout(wallet, "N3");
        }
      }
    } catch (error: any) {
      console.error(`\n❌ Error measuring wallet ${wallet}:`, error.message);
    }
  }

  // Summary Report
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY REPORT: JOIN FANOUT ANALYSIS");
  console.log("=".repeat(80));

  console.log("\n📊 Row Count Progression by Wallet:\n");
  console.log("Wallet".padEnd(45) + "N0".padEnd(10) + "N1".padEnd(10) + "N2".padEnd(10) + "N3".padEnd(10));
  console.log("-".repeat(85));

  for (const r of results) {
    const walletShort = r.wallet.substring(0, 10) + "..." + r.wallet.substring(r.wallet.length - 6);
    console.log(
      walletShort.padEnd(45) +
      r.n0.toString().padEnd(10) +
      r.n1.toString().padEnd(10) +
      r.n2.toString().padEnd(10) +
      r.n3.toString().padEnd(10)
    );
  }

  console.log("\n📈 Fanout Ratios by Stage:\n");
  console.log("Wallet".padEnd(45) + "F1 (N1/N0)".padEnd(15) + "F2 (N2/N1)".padEnd(15) + "F3 (N3/N2)".padEnd(15) + "Total (N3/N0)".padEnd(15) + "Status");
  console.log("-".repeat(105));

  for (const r of results) {
    const walletShort = r.wallet.substring(0, 10) + "..." + r.wallet.substring(r.wallet.length - 6);
    const status = r.pass ? "✅ PASS" : "❌ FAIL";
    console.log(
      walletShort.padEnd(45) +
      r.fanout_1.toFixed(6).padEnd(15) +
      r.fanout_2.toFixed(6).padEnd(15) +
      r.fanout_3.toFixed(6).padEnd(15) +
      r.total_fanout.toFixed(6).padEnd(15) +
      status
    );
  }

  // Pass/Fail Decision
  console.log("\n" + "=".repeat(80));
  console.log("PASS/FAIL DECISION");
  console.log("=".repeat(80));

  const allPass = results.every(r => r.pass);
  const passCount = results.filter(r => r.pass).length;

  console.log(`\n✅ Passed: ${passCount}/${results.length} wallets`);
  console.log(`❌ Failed: ${results.length - passCount}/${results.length} wallets\n`);

  if (allPass) {
    console.log("🎉 ALL WALLETS PASS FANOUT GUARDRAIL");
    console.log("\n✅ Join safety confirmed:");
    console.log("   - No row multiplication detected");
    console.log("   - ANY LEFT JOIN pattern working correctly");
    console.log("   - All fanouts within 0.1% tolerance");
    console.log("   - Ready for Step 7: Full P&L reconciliation\n");
  } else {
    console.log("⚠️  SOME WALLETS FAILED FANOUT GUARDRAIL");
    console.log("\n❌ Required remediation:");
    console.log("   - Review join conditions causing fanout");
    console.log("   - Consider adding DISTINCT or switching to semi-joins");
    console.log("   - Verify dimension table cardinality");
    console.log("   - Re-run after fixes\n");
  }

  // Data integrity checks
  console.log("=".repeat(80));
  console.log("DATA INTEGRITY CHECKS");
  console.log("=".repeat(80));

  for (const r of results) {
    const walletShort = r.wallet.substring(0, 10) + "..." + r.wallet.substring(r.wallet.length - 6);
    console.log(`\n${walletShort}:`);

    // Check for row loss (should be >= 95% retention for legitimate inner joins)
    const retention = r.n0 > 0 ? (r.n3 / r.n0) * 100 : 100;
    const retentionOk = retention >= 95;
    console.log(`   Row retention: ${retention.toFixed(2)}% ${retentionOk ? '✅' : '⚠️'}`);

    if (r.n3 < r.n0 * 0.95) {
      console.log(`   ⚠️  Significant row loss detected (${r.n0 - r.n3} rows lost)`);
    }

    if (r.n3 > r.n0) {
      console.log(`   ⚠️  Row multiplication detected (+${r.n3 - r.n0} rows)`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("FINAL VERDICT");
  console.log("=".repeat(80));
  console.log(`\n${allPass ? '✅ PASS' : '❌ FAIL'}: Join fanout verification ${allPass ? 'successful' : 'failed'}`);
  console.log(`\nStep 6 Status: ${allPass ? 'COMPLETE ✅' : 'BLOCKED ❌'}`);
  if (allPass) {
    console.log("Next Step: Proceed to Step 7 - Full P&L reconciliation\n");
  } else {
    console.log("Action Required: Fix fanout issues before proceeding to Step 7\n");
  }

  await ch.close();
}

main().catch(console.error);
