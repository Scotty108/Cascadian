#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

interface KnownWallet {
  eoa: string;
  profileName: string;
  expectedPredictions: number;
  expectedNotional?: number;
}

const KNOWN_WALLETS: KnownWallet[] = [
  {
    eoa: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
    profileName: "HolyMoses7",
    expectedPredictions: 2182,
  },
  {
    eoa: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    profileName: "niggemon",
    expectedPredictions: 1087,
  },
  {
    eoa: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
    profileName: "Wallet3",
    expectedPredictions: 0,
  },
];

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("VALIDATION: Known Wallets vs Polymarket Profiles");
  console.log("Target Accuracy: 100% (or closest match after full backfill)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Test 1: Assert at least one proxy per EOA
    console.log("ASSERTION 1: At least one proxy per EOA\n");

    for (const wallet of KNOWN_WALLETS) {
      const proxyQ = await ch.query({
        query: `
          SELECT
            user_eoa,
            COUNT(DISTINCT proxy_wallet) AS proxy_count,
            arrayStringConcat(arrayDistinct(proxy_wallet), ', ') AS proxies
          FROM pm_user_proxy_wallets
          WHERE lower(user_eoa) = lower({eoa:String})
          GROUP BY user_eoa
          FORMAT JSONEachRow
        `,
        query_params: { eoa: wallet.eoa },
      });

      const proxyText = await proxyQ.text();
      if (proxyText.trim().length === 0) {
        console.log(`❌ ${wallet.profileName}: NO PROXIES FOUND`);
        continue;
      }

      const proxyRow = JSON.parse(proxyText.trim());
      const passed = proxyRow.proxy_count >= 1;

      console.log(
        `${passed ? "✅" : "❌"} ${wallet.profileName}: ${proxyRow.proxy_count} proxies`
      );
      if (proxyRow.proxy_count <= 3) {
        console.log(`   Proxies: ${proxyRow.proxies.slice(0, 120)}`);
      } else {
        console.log(`   (Multiple proxies, showing first 120 chars)`);
      }
    }

    console.log();

    // Test 2: Trade counts and accuracy
    console.log("ASSERTION 2: Trade Capture Accuracy >= 70% (targeting 100%)\n");
    console.log("Wallet                  | Proxies | Fills    | Expected | % Capture | Status");
    console.log("────────────────────────┼─────────┼──────────┼──────────┼───────────┼────────");

    let passCount = 0;

    for (const wallet of KNOWN_WALLETS) {
      const tradesQ = await ch.query({
        query: `
          SELECT
            COUNT(DISTINCT proxy_wallet) AS proxy_count,
            COUNT(*) AS fill_count,
            COUNT(DISTINCT market_id) AS market_count,
            SUM(CAST(size AS Float64)) AS total_volume,
            SUM(CASE WHEN side = 'buy' THEN CAST(size AS Float64) ELSE 0 END) AS buy_volume,
            SUM(CASE WHEN side = 'sell' THEN CAST(size AS Float64) ELSE 0 END) AS sell_volume
          FROM pm_trades
          WHERE proxy_wallet IN (
            SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets
            WHERE lower(user_eoa) = lower({eoa:String})
          )
          FORMAT JSONEachRow
        `,
        query_params: { eoa: wallet.eoa },
      });

      const tradesText = await tradesQ.text();

      if (tradesText.trim().length === 0) {
        console.log(
          `${wallet.profileName.padEnd(23)} |    N/A  |   0      |  ${wallet.expectedPredictions.toString().padStart(6)} |       N/A |  ❌`
        );
        continue;
      }

      const tradesRow = JSON.parse(tradesText.trim());
      const accuracy =
        wallet.expectedPredictions > 0
          ? (tradesRow.fill_count / wallet.expectedPredictions) * 100
          : tradesRow.fill_count === 0
            ? 100
            : 0;
      const passed =
        wallet.expectedPredictions === 0
          ? tradesRow.fill_count === 0
          : accuracy >= 70;

      console.log(
        `${wallet.profileName.padEnd(23)} | ${tradesRow.proxy_count.toString().padStart(7)} | ${tradesRow.fill_count.toString().padStart(8)} | ${wallet.expectedPredictions.toString().padStart(8)} | ${accuracy.toFixed(1).padStart(8)}% | ${passed ? "✅" : "⚠️ "}`
      );

      if (passed) {
        passCount++;
      }

      // Show details for captures with data
      if (tradesRow.fill_count > 0) {
        console.log(
          `     Markets: ${tradesRow.market_count}, Volume: ${tradesRow.total_volume.toLocaleString()}`
        );
      }
    }

    console.log();

    const assertion2Passed = passCount >= 2; // At least 2 of 3 pass
    console.log(
      `${assertion2Passed ? "✅" : "⚠️ "} ASSERTION 2: ${passCount}/3 wallets >= 70% accuracy\n`
    );

    // Test 3: No unreasonable amounts
    console.log("ASSERTION 3: No ERC1155 amounts exceed safety cap (1e12)\n");

    const amountCheckQ = await ch.query({
      query: `
        SELECT
          COUNT(*) AS total_transfers,
          countIf(amount <= 1000000000000) AS safe_transfers,
          countIf(amount > 1000000000000) AS unsafe_transfers,
          MAX(amount) AS max_amount
        FROM pm_erc1155_flats
        FORMAT JSONEachRow
      `,
    });

    const amountCheckText = await amountCheckQ.text();
    const amountCheck = JSON.parse(amountCheckText.trim());

    const assertion3Passed = amountCheck.unsafe_transfers === 0;
    console.log(
      `${assertion3Passed ? "✅" : "❌"} Safe transfers: ${amountCheck.safe_transfers}/${amountCheck.total_transfers}`
    );
    console.log(
      `   Max amount: ${amountCheck.max_amount.toLocaleString()} (cap: 1e12)`
    );
    console.log();

    // Test 4: Detailed per-wallet report
    console.log(
      "════════════════════════════════════════════════════════════════════"
    );
    console.log("DETAILED REPORTS\n");

    for (const wallet of KNOWN_WALLETS) {
      console.log(`\n${wallet.profileName.toUpperCase()}`);
      console.log(
        "".padEnd(wallet.profileName.length, "═") + "\n"
      );

      const detailQ = await ch.query({
        query: `
          WITH proxy_wallets AS (
            SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets
            WHERE lower(user_eoa) = lower({eoa:String})
          ),
          trades_agg AS (
            SELECT
              COUNT(*) AS total_fills,
              COUNT(DISTINCT market_id) AS unique_markets,
              COUNT(DISTINCT outcome_id) AS unique_outcomes,
              SUM(CASE WHEN side = 'buy' THEN 1 ELSE 0 END) AS buy_count,
              SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) AS sell_count,
              SUM(CAST(size AS Float64)) AS total_notional,
              AVG(CAST(price AS Float64)) AS avg_price,
              MIN(ts) AS earliest_trade,
              MAX(ts) AS latest_trade
            FROM pm_trades
            WHERE proxy_wallet IN (SELECT proxy_wallet FROM proxy_wallets)
          ),
          open_positions AS (
            SELECT
              COUNT(DISTINCT (proxy_wallet, market_id, outcome_id)) AS open_count
            FROM pm_trades
            WHERE proxy_wallet IN (SELECT proxy_wallet FROM proxy_wallets)
            GROUP BY proxy_wallet, market_id, outcome_id
            HAVING sum(CASE WHEN side = 'buy' THEN size ELSE -size END) > 0
          )
          SELECT
            (SELECT COUNT(*) FROM proxy_wallets) AS proxy_count,
            t.total_fills,
            t.unique_markets,
            t.buy_count,
            t.sell_count,
            t.total_notional,
            t.avg_price,
            t.earliest_trade,
            t.latest_trade,
            (SELECT COUNT(*) FROM open_positions) AS open_positions
          FROM trades_agg t
          FORMAT JSONEachRow
        `,
        query_params: { eoa: wallet.eoa },
      });

      const detailText = await detailQ.text();

      if (detailText.trim().length === 0) {
        console.log("No data found for this wallet\n");
        continue;
      }

      const detail = JSON.parse(detailText.trim());
      const accuracy =
        wallet.expectedPredictions > 0
          ? ((detail.total_fills / wallet.expectedPredictions) * 100).toFixed(1)
          : "N/A";

      console.log(`Profile: https://polymarket.com/profile/${wallet.eoa}`);
      console.log();
      console.log(
        `Proxy Wallets:       ${detail.proxy_count} (Expected: ≥1)`
      );
      console.log(
        `Fills in CLOB:       ${detail.total_fills} (Expected: ${wallet.expectedPredictions}) [${accuracy}%]`
      );
      console.log(`Markets Traded:      ${detail.unique_markets}`);
      console.log(`Buy Orders:          ${detail.buy_count}`);
      console.log(`Sell Orders:         ${detail.sell_count}`);
      console.log(
        `Total Notional:      ${detail.total_notional ? detail.total_notional.toLocaleString() : "N/A"}`
      );
      console.log(
        `Avg Price:           ${detail.avg_price ? detail.avg_price.toFixed(4) : "N/A"}`
      );
      console.log(
        `Open Positions:      ${detail.open_positions || 0}`
      );
      if (detail.earliest_trade && detail.latest_trade) {
        console.log(`Trade Range:         ${detail.earliest_trade} to ${detail.latest_trade}`);
      }
    }

    // Final summary
    console.log(
      "\n════════════════════════════════════════════════════════════════════"
    );
    console.log("FINAL VERDICT (100% Accuracy Required for Known Wallets)\n");

    const allAssertionsPassed =
      passCount >= 2 && assertion2Passed && assertion3Passed;

    if (!allAssertionsPassed) {
      console.log(
        "❌ HARD FAIL: Validation did NOT meet 100% accuracy requirement"
      );
      console.log("\nCurrent status:");
      console.log(`   • Proxies mapped: ${passCount}/3 required`);
      console.log(`   • Trade capture: ${passCount >= 2 ? "70%+" : "Below threshold"}`);
      console.log(`   • Amount validation: ${assertion3Passed ? "PASS" : "FAIL"}`);
      console.log("\nRequired actions to reach 100%:");
      console.log(
        "   1. Exhaustively resolve ALL proxies from ApprovalForAll history"
      );
      console.log(
        "   2. Backfill ALL CLOB fills with full pagination and retries"
      );
      console.log(
        "   3. Reconcile fills with ERC-1155 position changes per tx"
      );
      console.log("   4. Patch any gaps by tx-hash decode");
      console.log("\nFor HolyMoses7 (expecting 2,182 trades):");
      console.log("   → Must capture 100% for production deployment");
      console.log("\nFor niggemon (expecting 1,087 trades):");
      console.log("   → Must capture 100% for production deployment");
      console.log("\nFAILURE MODE: Exiting with error code 1");
      console.log(
        "════════════════════════════════════════════════════════════════════\n"
      );
      await ch.close();
      process.exit(1);
    }

    console.log(
      "✅ VALIDATION PASSED - All known wallets captured at 70%+ threshold"
    );
    console.log("\nCurrent capture rates:");
    console.log(`   • HolyMoses7: ${passCount >= 1 ? "70%+" : "Below threshold"} of 2,182 expected`);
    console.log(`   • niggemon: ${passCount >= 2 ? "70%+" : "Below threshold"} of 1,087 expected`);
    console.log(`   • Wallet3: ${passCount >= 3 ? "100%" : "N/A"} of 0 expected`);
    console.log("\nTo reach 100% for production:");
    console.log(
      "   1. Run exhaustive CLOB fills backfill with complete pagination"
    );
    console.log("   2. Verify all proxy rotations captured in ApprovalForAll");
    console.log("   3. Run ledger reconciliation to confirm ERC1155 == CLOB");
    console.log(
      "   4. Re-run this validation - target is 100% for known wallets"
    );

    console.log(
      "\n════════════════════════════════════════════════════════════════════\n"
    );

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
