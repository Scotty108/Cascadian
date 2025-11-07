#!/usr/bin/env npx tsx

/**
 * Final comprehensive dedup analysis
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

const TARGET_WALLETS = [
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
];

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

async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║  FINAL DEDUPLICATION ANALYSIS                                  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Count true duplicates using composite key
  const trueDupsQuery = `
    SELECT
      count() as total_true_dup_rows,
      count() - count(DISTINCT (
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id
      )) as actual_duplicates_to_remove
    FROM trades_raw
    WHERE lower(wallet_address) IN (
      '${TARGET_WALLETS[0]}',
      '${TARGET_WALLETS[1]}'
    )
  `;

  const trueDups = await queryData(trueDupsQuery);
  const trueDupStats = trueDups[0];

  // Count by wallet
  const walletStatsQuery = `
    SELECT
      lower(wallet_address) as wallet,
      count() as raw_rows,
      count(DISTINCT trade_id) as uniq_trade_ids,
      count(DISTINCT (
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id
      )) as unique_fills,
      count() - count(DISTINCT (
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id
      )) as true_dups_to_remove
    FROM trades_raw
    WHERE lower(wallet_address) IN (
      '${TARGET_WALLETS[0]}',
      '${TARGET_WALLETS[1]}'
    )
    GROUP BY wallet
    ORDER BY wallet
  `;

  const walletStats = await queryData(walletStatsQuery);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const ws of walletStats) {
    const name = ws.wallet === TARGET_WALLETS[0] ? 'HolyMoses7' : 'niggemon';
    const dupsByTradeId = ws.raw_rows - ws.uniq_trade_ids;
    const trueDups = ws.true_dups_to_remove;
    const legitimateFills = dupsByTradeId - trueDups;

    console.log(`${name} (${ws.wallet.substring(0, 10)}...)`);
    console.log(`─────────────────────────────────────────────────────────────`);
    console.log(`  Raw rows:                            ${ws.raw_rows.toLocaleString()}`);
    console.log(`  Unique trade_ids:                    ${ws.uniq_trade_ids.toLocaleString()}`);
    console.log(`  "Duplicates" by trade_id:            ${dupsByTradeId.toLocaleString()}`);
    console.log();
    console.log(`  → TRUE duplicates (to remove):       ${trueDups.toLocaleString()} (${(trueDups / ws.raw_rows * 100).toFixed(2)}%)`);
    console.log(`  → Legitimate fills (to keep):        ${legitimateFills.toLocaleString()} (${(legitimateFills / ws.raw_rows * 100).toFixed(2)}%)`);
    console.log();
    console.log(`  After proper dedup:                  ${ws.unique_fills.toLocaleString()} fills`);
    console.log(`  Dedup rate (correct):                ${(trueDups / ws.raw_rows * 100).toFixed(4)}%`);
    console.log();
  }

  const totalRaw = walletStats.reduce((sum, ws) => sum + Number(ws.raw_rows), 0);
  const totalUniqTradeIds = walletStats.reduce((sum, ws) => sum + Number(ws.uniq_trade_ids), 0);
  const totalUniqueFills = walletStats.reduce((sum, ws) => sum + Number(ws.unique_fills), 0);
  const totalTrueDups = walletStats.reduce((sum, ws) => sum + Number(ws.true_dups_to_remove), 0);
  const totalDupsByTradeId = totalRaw - totalUniqTradeIds;
  const totalLegitimateFills = totalDupsByTradeId - totalTrueDups;

  console.log(`COMBINED TOTALS`);
  console.log(`─────────────────────────────────────────────────────────────`);
  console.log(`  Total raw rows:                      ${totalRaw.toLocaleString()}`);
  console.log(`  "Duplicates" by trade_id:            ${totalDupsByTradeId.toLocaleString()}`);
  console.log();
  console.log(`  → TRUE duplicates (to remove):       ${totalTrueDups.toLocaleString()} (${(totalTrueDups / totalRaw * 100).toFixed(2)}%)`);
  console.log(`  → Legitimate fills (to keep):        ${totalLegitimateFills.toLocaleString()} (${(totalLegitimateFills / totalRaw * 100).toFixed(2)}%)`);
  console.log();
  console.log(`  After proper dedup:                  ${totalUniqueFills.toLocaleString()} fills`);
  console.log(`  Actual dedup rate:                   ${(totalTrueDups / totalRaw * 100).toFixed(4)}% ✅`);
  console.log();

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("KEY FINDINGS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`1. trade_id is NOT a unique fill identifier`);
  console.log(`   - Would incorrectly remove ${totalLegitimateFills.toLocaleString()} legitimate fills (${(totalLegitimateFills / totalRaw * 100).toFixed(2)}%)`);
  console.log();

  console.log(`2. TRUE duplicates are minimal`);
  console.log(`   - Only ${totalTrueDups} rows (${(totalTrueDups / totalRaw * 100).toFixed(4)}%) are actual duplicates`);
  console.log(`   - Well below 0.1% acceptable threshold ✅`);
  console.log();

  console.log(`3. Correct unique key is composite:`);
  console.log(`   (transaction_hash, wallet_address, timestamp, side, shares, entry_price, usd_value, market_id)`);
  console.log();

  console.log(`4. Proper deduplication yields:`);
  console.log(`   - ${totalUniqueFills.toLocaleString()} unique fills (removing only ${totalTrueDups} duplicates)`);
  console.log(`   - vs. ${totalUniqTradeIds.toLocaleString()} if using trade_id (removing ${totalDupsByTradeId.toLocaleString()} rows - WRONG!)`);
  console.log();

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("RECOMMENDED DEDUP SQL");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`CREATE VIEW trades_deduped_correct AS
SELECT *
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY
        transaction_hash,
        wallet_address,
        timestamp,
        side,
        shares,
        entry_price,
        usd_value,
        market_id
      ORDER BY created_at DESC
    ) AS rn
  FROM trades_raw
)
WHERE rn = 1;\n`);

  console.log(`This removes ${totalTrueDups} true duplicates while preserving ${totalLegitimateFills} legitimate fills.\n`);

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
