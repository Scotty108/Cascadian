#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

interface LedgerEntry {
  proxy_wallet: string;
  market_id: string;
  outcome_id: string;
  net_erc1155: number;
  net_clob: number;
  matches: boolean;
  discrepancy: number;
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 3: LEDGER RECONCILIATION TEST");
  console.log("Validates: ERC1155 net units == CLOB fills net (buy - sell)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Test 1: Compare per-proxy net positions
    console.log("TEST 1: Per-Proxy Net Position Reconciliation\n");
    console.log("Comparing ERC1155 net position vs CLOB fills net...\n");

    const reconcileQ = await ch.query({
      query: `
        WITH erc1155_nets AS (
          SELECT
            to_addr AS proxy_wallet,
            id_hex as token_id,
            COALESCE(market_id, '') AS market_id,
            COALESCE(outcome_index, 0) AS outcome_id,
            sum(CAST(value_raw_hex AS Int256)) AS net_erc1155
          FROM pm_erc1155_flats
          LEFT JOIN ctf_token_map ON pm_erc1155_flats.id_hex = ctf_token_map.token_id
          WHERE to_addr != '' AND to_addr != '0x0000000000000000000000000000000000000000'
          GROUP BY proxy_wallet, token_id, market_id, outcome_id
        ),
        clob_nets AS (
          SELECT
            proxy_wallet,
            market_id,
            outcome_id,
            sum(CASE
              WHEN side = 'buy' THEN CAST(size AS Int256)
              WHEN side = 'sell' THEN -CAST(size AS Int256)
              ELSE 0
            END) AS net_clob
          FROM pm_trades
          WHERE market_id != '' AND outcome_id != ''
          GROUP BY proxy_wallet, market_id, outcome_id
        ),
        reconcile AS (
          SELECT
            COALESCE(e.proxy_wallet, c.proxy_wallet) AS proxy_wallet,
            COALESCE(e.market_id, c.market_id) AS market_id,
            COALESCE(e.outcome_id, c.outcome_id) AS outcome_id,
            e.net_erc1155,
            c.net_clob,
            (e.net_erc1155 IS NOT NULL AND c.net_clob IS NOT NULL
             AND e.net_erc1155 = c.net_clob) AS matches,
            abs(COALESCE(e.net_erc1155, 0) - COALESCE(c.net_clob, 0)) AS discrepancy
          FROM erc1155_nets e
          FULL OUTER JOIN clob_nets c
            ON e.proxy_wallet = c.proxy_wallet
            AND e.market_id = c.market_id
            AND e.outcome_id = c.outcome_id
        )
        SELECT
          proxy_wallet,
          market_id,
          outcome_id,
          net_erc1155,
          net_clob,
          matches,
          discrepancy
        FROM reconcile
        WHERE discrepancy > 0 OR net_erc1155 IS NULL OR net_clob IS NULL
        ORDER BY discrepancy DESC, proxy_wallet
        LIMIT 100
      `,
    });

    const reconcileText = await reconcileQ.text();
    const reconcileData = JSON.parse(reconcileText);
    const reconcileLines = (reconcileData.data || []);

    if (reconcileLines.length === 0) {
      console.log("✅ Perfect reconciliation! All positions match.\n");
    } else {
      console.log(
        `⚠️  Found ${reconcileLines.length} mismatches (showing top 10):\n`
      );

      for (let i = 0; i < Math.min(10, reconcileLines.length); i++) {
        const entry = reconcileLines[i] as LedgerEntry;
        console.log(
          `${(i + 1)
            .toString()
            .padStart(2)}. ${entry.proxy_wallet.slice(0, 10)}... | Market: ${entry.market_id.slice(0, 12)}... | ERC1155: ${entry.net_erc1155} vs CLOB: ${entry.net_clob} (Δ${entry.discrepancy})`
        );
      }
      console.log();
    }

    // Test 2: Summary statistics
    console.log("\nTEST 2: Summary Statistics\n");

    const summaryQ = await ch.query({
      query: `
        WITH erc1155_nets AS (
          SELECT
            to_addr AS proxy_wallet,
            id_hex as token_id,
            COALESCE(market_id, '') AS market_id,
            COALESCE(outcome_index, 0) AS outcome_id,
            sum(CAST(value_raw_hex AS Int256)) AS net_erc1155
          FROM pm_erc1155_flats
          LEFT JOIN ctf_token_map ON pm_erc1155_flats.id_hex = ctf_token_map.token_id
          WHERE to_addr != '' AND to_addr != '0x0000000000000000000000000000000000000000'
          GROUP BY proxy_wallet, token_id, market_id, outcome_id
        ),
        clob_nets AS (
          SELECT
            proxy_wallet,
            market_id,
            outcome_id,
            sum(CASE
              WHEN side = 'buy' THEN CAST(size AS Int256)
              WHEN side = 'sell' THEN -CAST(size AS Int256)
              ELSE 0
            END) AS net_clob
          FROM pm_trades
          WHERE market_id != '' AND outcome_id != ''
          GROUP BY proxy_wallet, market_id, outcome_id
        ),
        reconcile AS (
          SELECT
            (e.net_erc1155 IS NOT NULL AND c.net_clob IS NOT NULL
             AND e.net_erc1155 = c.net_clob) AS matches
          FROM erc1155_nets e
          FULL OUTER JOIN clob_nets c
            ON e.proxy_wallet = c.proxy_wallet
            AND e.market_id = c.market_id
            AND e.outcome_id = c.outcome_id
        )
        SELECT
          COUNT(*) AS total_positions,
          countIf(matches = true) AS matched_positions,
          countIf(matches = false) AS mismatched_positions,
          round(100.0 * countIf(matches = true) / COUNT(*), 2) AS match_percentage
        FROM reconcile
      `,
    });

    const summaryText = await summaryQ.text();
    const summaryData = JSON.parse(summaryText);
    const summary = summaryData.data[0];

    console.log(`Total Positions: ${summary.total_positions}`);
    console.log(
      `Matched: ${summary.matched_positions} (${summary.match_percentage}%)`
    );
    console.log(`Mismatched: ${summary.mismatched_positions}`);
    console.log();

    // Test 3: Per-wallet summary
    console.log("\nTEST 3: Per-Wallet Reconciliation Status\n");

    const walletSummaryQ = await ch.query({
      query: `
        WITH erc1155_nets AS (
          SELECT
            to_addr AS proxy_wallet,
            id_hex as token_id,
            COALESCE(market_id, '') AS market_id,
            COALESCE(outcome_index, 0) AS outcome_id,
            sum(CAST(value_raw_hex AS Int256)) AS net_erc1155
          FROM pm_erc1155_flats
          LEFT JOIN ctf_token_map ON pm_erc1155_flats.id_hex = ctf_token_map.token_id
          WHERE to_addr != '' AND to_addr != '0x0000000000000000000000000000000000000000'
          GROUP BY proxy_wallet, token_id, market_id, outcome_id
        ),
        clob_nets AS (
          SELECT
            proxy_wallet,
            market_id,
            outcome_id,
            sum(CASE
              WHEN side = 'buy' THEN CAST(size AS Int256)
              WHEN side = 'sell' THEN -CAST(size AS Int256)
              ELSE 0
            END) AS net_clob
          FROM pm_trades
          WHERE market_id != '' AND outcome_id != ''
          GROUP BY proxy_wallet, market_id, outcome_id
        ),
        reconcile AS (
          SELECT
            COALESCE(e.proxy_wallet, c.proxy_wallet) AS proxy_wallet,
            (e.net_erc1155 IS NOT NULL AND c.net_clob IS NOT NULL
             AND e.net_erc1155 = c.net_clob) AS matches
          FROM erc1155_nets e
          FULL OUTER JOIN clob_nets c
            ON e.proxy_wallet = c.proxy_wallet
            AND e.market_id = c.market_id
            AND e.outcome_id = c.outcome_id
        )
        SELECT
          proxy_wallet,
          COUNT(*) AS positions,
          countIf(matches = true) AS matched,
          countIf(matches = false) AS mismatched,
          round(100.0 * countIf(matches = true) / COUNT(*), 1) AS match_pct
        FROM reconcile
        GROUP BY proxy_wallet
        ORDER BY match_pct ASC
        LIMIT 20
      `,
    });

    const walletSummaryText = await walletSummaryQ.text();
    const walletData = JSON.parse(walletSummaryText);
    const walletLines = walletData.data || [];

    console.log("Top 10 Wallets (by mismatch %):\n");
    for (let i = 0; i < Math.min(10, walletLines.length); i++) {
      const row = walletLines[i];
      const status = row.match_pct >= 95 ? "✅" : "⚠️ ";
      console.log(
        `${status} ${row.proxy_wallet.slice(0, 14)}... | ${row.positions} positions | ${row.matched}/${row.positions} matched (${row.match_pct}%)`
      );
    }

    // Test 4: Acceptance criteria - HARD FAIL for 95% accuracy requirement
    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log("ACCEPTANCE CRITERIA (Hard-Fail for 95% Global + 100% on Known EOAs)\n");

    const criteria = summary.match_percentage >= 95;
    console.log(
      `[${criteria ? "✅" : "❌"}] Global match percentage >= 95%: ${summary.match_percentage}%`
    );

    // Check known wallets specifically
    console.log("\n[KNOWN WALLET TOLERANCE] Zero unit tolerance for:\n");
    const knownWallets = [
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    ];

    let knownWalletsPass = true;
    for (const eoa of knownWallets) {
      const knownQ = await ch.query({
        query: `
          WITH erc1155_nets AS (
            SELECT
              to_addr AS proxy_wallet,
              id_hex as token_id,
              COALESCE(market_id, '') AS market_id,
              COALESCE(outcome_index, 0) AS outcome_id,
              sum(CAST(value_raw_hex AS Int256)) AS net_erc1155
            FROM pm_erc1155_flats
            LEFT JOIN ctf_token_map ON pm_erc1155_flats.id_hex = ctf_token_map.token_id
            WHERE lower(to_addr) = lower({eoa:String})
            GROUP BY proxy_wallet, token_id, market_id, outcome_id
          ),
          clob_nets AS (
            SELECT
              proxy_wallet,
              market_id,
              outcome_id,
              sum(CASE
                WHEN side = 'buy' THEN CAST(size AS Int256)
                WHEN side = 'sell' THEN -CAST(size AS Int256)
                ELSE 0
              END) AS net_clob
            FROM pm_trades
            WHERE market_id != '' AND outcome_id != ''
              AND proxy_wallet IN (
                SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets
                WHERE lower(user_eoa) = lower({eoa:String})
              )
            GROUP BY proxy_wallet, market_id, outcome_id
          )
          SELECT countIf(e.net_erc1155 != c.net_clob OR (e.net_erc1155 IS NULL) != (c.net_clob IS NULL)) as mismatches
          FROM erc1155_nets e
          FULL OUTER JOIN clob_nets c
            ON e.proxy_wallet = c.proxy_wallet
            AND e.market_id = c.market_id
            AND e.outcome_id = c.outcome_id
        `,
        query_params: { eoa },
      });
      const knownText = await knownQ.text();
      const knownData = JSON.parse(knownText);
      const mismatchCount = knownData.data[0].mismatches || 0;
      const passed = mismatchCount === 0;
      if (!passed) knownWalletsPass = false;
      console.log(`  ${passed ? "✅" : "❌"} ${eoa.slice(0, 10)}...: ${mismatchCount} mismatches`);
    }

    console.log("\n════════════════════════════════════════════════════════════════════\n");

    if (!criteria || !knownWalletsPass) {
      console.log("❌ HARD FAIL: Ledger reconciliation did NOT meet 95% threshold");
      console.log("\nGap indicates:");
      console.log("   1. Incomplete CLOB fills (check pagination and resume tokens)");
      console.log("   2. Missing proxies (check ApprovalForAll mapping)");
      console.log(
        "   3. ERC1155 decoding issues (check TransferBatch handling)"
      );
      console.log("   4. Settlement/redemption flows not captured");
      console.log("\nTo reach 100% for known wallets:");
      console.log("   • Exhaustively resolve all their proxies from approvals history");
      console.log("   • Backfill all CLOB fills with pagination and retries");
      console.log("   • Reconcile fills with ERC-1155 position changes");
      console.log("   • Patch any gaps by tx-hash decode");
      console.log("\nFAILURE MODE: Exiting with error code 1");
      await ch.close();
      process.exit(1);
    }

    console.log("✅ HARD PASS: Ledger reconciliation meets 95% threshold");
    console.log("   ERC1155 net positions match CLOB fills net across 95%+ of entries");
    console.log("   Known wallets reconcile at 100%\n");

    console.log("════════════════════════════════════════════════════════════════════\n");

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
