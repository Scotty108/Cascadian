import { clickhouse } from "@/lib/clickhouse/client";

const ACCOUNT_WALLET = "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b";
const EXECUTOR_WALLET = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";
const XI_MARKET_CONDITION_ID = "f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1";

async function runValidation() {
  console.log("=".repeat(80));
  console.log("WALLET RELATIONSHIP VALIDATION");
  console.log("=".repeat(80));
  console.log(`Account Wallet: ${ACCOUNT_WALLET}`);
  console.log(`Executor Wallet: ${EXECUTOR_WALLET}`);
  console.log("=".repeat(80));

  try {
    // Query 1: Check trades in pm_trades_canonical_v3 for both wallets
    console.log("\n[QUERY 1] Trades in pm_trades_canonical_v3");
    console.log("-".repeat(80));

    const q1_account_exact = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Account (exact)' as type FROM pm_trades_canonical_v3 WHERE trader_address = '${ACCOUNT_WALLET}'`,
      format: "JSONEachRow",
    });
    console.log("Q1a: Account wallet (exact case)");
    console.log(await q1_account_exact.json());

    const q1_account_lower = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Account (lowercase)' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${ACCOUNT_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("\nQ1b: Account wallet (lowercase)");
    console.log(await q1_account_lower.json());

    const q1_executor_exact = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Executor (exact)' as type FROM pm_trades_canonical_v3 WHERE trader_address = '${EXECUTOR_WALLET}'`,
      format: "JSONEachRow",
    });
    console.log("\nQ1c: Executor wallet (exact case)");
    console.log(await q1_executor_exact.json());

    const q1_executor_lower = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Executor (lowercase)' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("\nQ1d: Executor wallet (lowercase)");
    console.log(await q1_executor_lower.json());

    // Query 2: ERC20 transfers
    console.log("\n\n[QUERY 2] ERC20 Transfers Activity");
    console.log("-".repeat(80));

    const q2_account_from = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Account (from)' as type FROM erc20_transfers_decoded WHERE LOWER(from_address) = LOWER('${ACCOUNT_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("Q2a: Account wallet (from_address)");
    console.log(await q2_account_from.json());

    const q2_account_to = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Account (to)' as type FROM erc20_transfers_decoded WHERE LOWER(to_address) = LOWER('${ACCOUNT_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("\nQ2b: Account wallet (to_address)");
    console.log(await q2_account_to.json());

    const q2_executor_from = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Executor (from)' as type FROM erc20_transfers_decoded WHERE LOWER(from_address) = LOWER('${EXECUTOR_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("\nQ2c: Executor wallet (from_address)");
    console.log(await q2_executor_from.json());

    const q2_executor_to = await clickhouse.query({
      query: `SELECT COUNT(*) as count, 'Executor (to)' as type FROM erc20_transfers_decoded WHERE LOWER(to_address) = LOWER('${EXECUTOR_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("\nQ2d: Executor wallet (to_address)");
    console.log(await q2_executor_to.json());

    // Query 3: Transaction hash overlap
    console.log("\n\n[QUERY 3] Transaction Hash Overlap");
    console.log("-".repeat(80));

    const q3_account_txs = await clickhouse.query({
      query: `SELECT COUNT(DISTINCT transaction_hash) as tx_count, 'Account' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${ACCOUNT_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("Q3a: Account wallet transaction_hash count");
    console.log(await q3_account_txs.json());

    const q3_executor_txs = await clickhouse.query({
      query: `SELECT COUNT(DISTINCT transaction_hash) as tx_count, 'Executor' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}')`,
      format: "JSONEachRow",
    });
    console.log("\nQ3b: Executor wallet transaction_hash count");
    console.log(await q3_executor_txs.json());

    const q3_overlap = await clickhouse.query({
      query: `
        WITH account_txs AS (
          SELECT DISTINCT transaction_hash FROM pm_trades_canonical_v3
          WHERE LOWER(trader_address) = LOWER('${ACCOUNT_WALLET}')
        ),
        executor_txs AS (
          SELECT DISTINCT transaction_hash FROM pm_trades_canonical_v3
          WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}')
        )
        SELECT COUNT(*) as overlapping_txs
        FROM account_txs
        WHERE transaction_hash IN (SELECT transaction_hash FROM executor_txs)
      `,
      format: "JSONEachRow",
    });
    console.log("\nQ3c: Overlapping transaction_hash count");
    console.log(await q3_overlap.json());

    // Query 4: Xi market condition_id for executor
    console.log("\n\n[QUERY 4] Xi Market Condition Coverage");
    console.log("-".repeat(80));
    console.log(`Xi Market condition_id: ${XI_MARKET_CONDITION_ID}`);

    const q4_executor = await clickhouse.query({
      query: `SELECT COUNT(*) as xi_trades FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}') AND condition_id = '${XI_MARKET_CONDITION_ID}'`,
      format: "JSONEachRow",
    });
    console.log("Q4a: Executor trades in Xi market");
    console.log(await q4_executor.json());

    const q4_account = await clickhouse.query({
      query: `SELECT COUNT(*) as xi_trades FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${ACCOUNT_WALLET}') AND condition_id = '${XI_MARKET_CONDITION_ID}'`,
      format: "JSONEachRow",
    });
    console.log("\nQ4b: Account trades in Xi market");
    console.log(await q4_account.json());

    // Query 5: Sample trades from executor
    console.log("\n\n[QUERY 5] Sample Trades from Executor (first 5)");
    console.log("-".repeat(80));

    const q5_sample = await clickhouse.query({
      query: `
        SELECT 
          trader_address,
          condition_id,
          transaction_hash,
          token_id,
          outcome_index,
          buy_sell_direction,
          quantity,
          price
        FROM pm_trades_canonical_v3
        WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}')
        LIMIT 5
      `,
      format: "JSONEachRow",
    });
    console.log("Q5: Sample executor trades");
    console.log(await q5_sample.json());

    console.log("\n" + "=".repeat(80));
    console.log("VALIDATION COMPLETE");
    console.log("=".repeat(80));

  } catch (error) {
    console.error("Error during validation:", error);
  }
}

runValidation();
