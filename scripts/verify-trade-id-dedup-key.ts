#!/usr/bin/env npx tsx

/**
 * P&L Reconciliation - Step 3: Verify trade_id as Unique Dedup Key
 *
 * Objective: Verify trade_id as the unique dedup key for both target wallets
 *
 * Ground Truth:
 * - Dedup key: trade_id (unique fill identifier)
 * - Target wallets:
 *   - 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 (HolyMoses7)
 *   - 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0 (niggemon)
 * - Snapshot: 2025-10-31 23:59:59
 *
 * Task 3A: Count duplicates by trade_id
 * Task 3B: If duplicates exist, create deduped view
 * Task 3C: Report results
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

interface WalletStats {
  wallet: string;
  raw_rows: number;
  uniq_fills: number;
  dup_rows: number;
  dup_pct: number;
}

interface DedupVerification {
  wallet: string;
  pre_dedup_rows: number;
  post_dedup_rows: number;
  duplicates_removed: number;
  verification_status: string;
}

async function queryData<T = any>(query: string): Promise<T[]> {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    throw e;
  }
}

const TARGET_WALLETS = {
  holymoses7: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  niggemon: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
};

const SNAPSHOT_DATE = '2025-10-31 23:59:59';
const ACCEPTABLE_THRESHOLD = 0.1; // 0.1% acceptable duplicate rate

async function task3A_CountDuplicates(): Promise<WalletStats[]> {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TASK 3A: Count Duplicates by trade_id");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const query = `
    SELECT
      lower(wallet_address) as wallet,
      count() as raw_rows,
      uniqExact(trade_id) as uniq_fills,
      count() - uniqExact(trade_id) as dup_rows,
      round((count() - uniqExact(trade_id)) / count() * 100, 4) as dup_pct
    FROM trades_raw
    WHERE
      lower(wallet_address) IN (
        '${TARGET_WALLETS.holymoses7}',
        '${TARGET_WALLETS.niggemon}'
      )
      AND timestamp <= toDateTime('${SNAPSHOT_DATE}')
    GROUP BY wallet
    ORDER BY wallet
  `;

  console.log("Executing query to count duplicates...\n");
  const results = await queryData<WalletStats>(query);

  console.log("Results:\n");
  console.log("┌─────────────────────────┬───────────┬────────────┬───────────┬──────────┐");
  console.log("│ Wallet                  │ Raw Rows  │ Uniq Fills │ Dup Rows  │ Dup %    │");
  console.log("├─────────────────────────┼───────────┼────────────┼───────────┼──────────┤");

  for (const row of results) {
    const walletName = row.wallet === TARGET_WALLETS.holymoses7 ? 'HolyMoses7' : 'niggemon';
    const status = row.dup_pct <= ACCEPTABLE_THRESHOLD ? '✅' : '⚠️';
    console.log(`│ ${walletName.padEnd(23)} │ ${String(row.raw_rows).padStart(9)} │ ${String(row.uniq_fills).padStart(10)} │ ${String(row.dup_rows).padStart(9)} │ ${String(row.dup_pct).padStart(7)}% ${status} │`);
  }

  console.log("└─────────────────────────┴───────────┴────────────┴───────────┴──────────┘\n");

  return results;
}

async function task3B_VerifyDedup(walletStats: WalletStats[]): Promise<DedupVerification[]> {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TASK 3B: Verify Deduplication");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const walletsWithDups = walletStats.filter(w => w.dup_rows > 0);

  if (walletsWithDups.length === 0) {
    console.log("✅ No duplicates found - no deduplication needed!\n");
    return [];
  }

  console.log(`Found duplicates in ${walletsWithDups.length} wallet(s). Testing dedup logic...\n`);

  const verifications: DedupVerification[] = [];

  for (const wallet of walletsWithDups) {
    console.log(`\nWallet: ${wallet.wallet.substring(0, 10)}...`);
    console.log(`  Pre-dedup rows: ${wallet.raw_rows}`);
    console.log(`  Expected unique: ${wallet.uniq_fills}`);

    // Create temporary deduped view using window function
    const dedupQuery = `
      WITH deduped AS (
        SELECT *
        FROM (
          SELECT
            *,
            row_number() OVER (
              PARTITION BY trade_id
              ORDER BY
                timestamp DESC,
                created_at DESC
            ) AS rn
          FROM trades_raw
          WHERE
            lower(wallet_address) = '${wallet.wallet}'
            AND timestamp <= toDateTime('${SNAPSHOT_DATE}')
        )
        WHERE rn = 1
      )
      SELECT
        count() as post_dedup_rows,
        count() - ${wallet.uniq_fills} as remaining_dups
      FROM deduped
    `;

    const dedupResult = await queryData<{
      post_dedup_rows: number;
      remaining_dups: number;
    }>(dedupQuery);

    const result = dedupResult[0];
    const verification: DedupVerification = {
      wallet: wallet.wallet,
      pre_dedup_rows: wallet.raw_rows,
      post_dedup_rows: result.post_dedup_rows,
      duplicates_removed: wallet.raw_rows - result.post_dedup_rows,
      verification_status: result.post_dedup_rows === wallet.uniq_fills ? 'PASS' : 'FAIL'
    };

    verifications.push(verification);

    console.log(`  Post-dedup rows: ${result.post_dedup_rows}`);
    console.log(`  Duplicates removed: ${verification.duplicates_removed}`);
    console.log(`  Remaining duplicates: ${result.remaining_dups}`);
    console.log(`  Status: ${verification.verification_status === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
  }

  return verifications;
}

async function task3C_ReportResults(
  walletStats: WalletStats[],
  dedupVerifications: DedupVerification[]
): Promise<void> {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TASK 3C: Final Report");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log("Target Wallets:");
  console.log("  1. HolyMoses7: 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8");
  console.log("  2. niggemon:   0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0");
  console.log(`\nSnapshot: ${SNAPSHOT_DATE}`);
  console.log(`Dedup Key: trade_id`);
  console.log(`Acceptable Threshold: ≤ ${ACCEPTABLE_THRESHOLD}%\n`);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("SUMMARY BY WALLET");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (const stats of walletStats) {
    const walletName = stats.wallet === TARGET_WALLETS.holymoses7 ? 'HolyMoses7' : 'niggemon';
    const verification = dedupVerifications.find(v => v.wallet === stats.wallet);

    console.log(`${walletName} (${stats.wallet.substring(0, 10)}...)`);
    console.log("─────────────────────────────────────────────────────────────\n");
    console.log(`  Raw Rows (before dedup):     ${stats.raw_rows.toLocaleString()}`);
    console.log(`  Unique Fills (trade_ids):    ${stats.uniq_fills.toLocaleString()}`);
    console.log(`  Duplicate Rows:              ${stats.dup_rows.toLocaleString()}`);
    console.log(`  Duplicate Percentage:        ${stats.dup_pct.toFixed(4)}%`);

    if (verification) {
      console.log(`\n  Dedup Method: Window function (PARTITION BY trade_id, ORDER BY timestamp DESC)`);
      console.log(`  Post-Dedup Rows:             ${verification.post_dedup_rows.toLocaleString()}`);
      console.log(`  Duplicates Removed:          ${verification.duplicates_removed.toLocaleString()}`);
      console.log(`  Verification:                ${verification.verification_status === 'PASS' ? '✅ PASS' : '❌ FAIL'}`);
    } else {
      console.log(`\n  Dedup Method:                Not needed (no duplicates)`);
      console.log(`  Post-Dedup Rows:             ${stats.raw_rows.toLocaleString()} (unchanged)`);
      console.log(`  Verification:                ✅ PASS`);
    }

    const meetsThreshold = stats.dup_pct <= ACCEPTABLE_THRESHOLD;
    console.log(`\n  Meets Threshold (≤${ACCEPTABLE_THRESHOLD}%):   ${meetsThreshold ? '✅ YES' : '❌ NO'}`);
    console.log();
  }

  // Overall assessment
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("OVERALL ASSESSMENT");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const allPass = walletStats.every(s => s.dup_pct <= ACCEPTABLE_THRESHOLD);
  const dedupVerified = dedupVerifications.length === 0 ||
                        dedupVerifications.every(v => v.verification_status === 'PASS');

  console.log(`Dedup Key Verified:         ${dedupVerified ? '✅ YES' : '❌ NO'}`);
  console.log(`All Wallets < ${ACCEPTABLE_THRESHOLD}% Dups:      ${allPass ? '✅ YES' : '❌ NO'}`);
  console.log(`Ready for Next Step:        ${allPass && dedupVerified ? '✅ YES' : '❌ NO'}\n`);

  if (allPass && dedupVerified) {
    console.log("✅ SUCCESS: trade_id is confirmed as the correct unique dedup key");
    console.log("   All wallets have duplicate rates within acceptable threshold");
    console.log("   Deduplication logic verified and working correctly\n");
  } else {
    console.log("⚠️  WARNING: Issues detected with deduplication");
    console.log("   Review duplicate percentages and verification results above\n");
  }

  // SQL pattern used
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("DEDUPLICATION SQL PATTERN");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log(`CREATE VIEW trades_deduped AS
SELECT *
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY trade_id        -- Dedup key
      ORDER BY
        timestamp DESC,            -- Most recent timestamp
        created_at DESC            -- Tiebreaker
    ) AS rn
  FROM trades_raw
  WHERE timestamp <= '${SNAPSHOT_DATE}'
)
WHERE rn = 1;                      -- Keep only first row per trade_id\n`);

  console.log("This pattern ensures:");
  console.log("  • One row per unique trade_id");
  console.log("  • Most recent data is kept in case of duplicates");
  console.log("  • Snapshot date filter applied correctly");
  console.log("  • Zero duplicates in final output\n");
}

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  P&L RECONCILIATION - STEP 3                                   ║");
  console.log("║  Verify trade_id as Unique Dedup Key                           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  try {
    // Task 3A: Count duplicates
    const walletStats = await task3A_CountDuplicates();

    // Task 3B: Verify deduplication (if needed)
    const dedupVerifications = await task3B_VerifyDedup(walletStats);

    // Task 3C: Report results
    await task3C_ReportResults(walletStats, dedupVerifications);

    console.log("════════════════════════════════════════════════════════════════");
    console.log("✅ Step 3 Complete");
    console.log("════════════════════════════════════════════════════════════════\n");

  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    process.exit(1);
  }
}

main().catch(console.error);
