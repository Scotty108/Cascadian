import { createClient } from "@clickhouse/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

const ACCOUNT_WALLET = "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b";
const EXECUTOR_WALLET = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";
const XI_MARKET_CONDITION_ID =
  "f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1";

async function runQuery(name, query) {
  try {
    const result = await client.query({ query, format: "JSONEachRow" });
    const data = await result.json();
    console.log(`\n${name}`);
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error(`Error in ${name}:`, error.message);
    return null;
  }
}

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

    await runQuery(
      "Q1a: Account wallet (exact case)",
      `SELECT COUNT(*) as count, 'Account (exact)' as type FROM pm_trades_canonical_v3 WHERE trader_address = '${ACCOUNT_WALLET}'`
    );

    await runQuery(
      "Q1b: Account wallet (lowercase)",
      `SELECT COUNT(*) as count, 'Account (lowercase)' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${ACCOUNT_WALLET}')`
    );

    await runQuery(
      "Q1c: Executor wallet (exact case)",
      `SELECT COUNT(*) as count, 'Executor (exact)' as type FROM pm_trades_canonical_v3 WHERE trader_address = '${EXECUTOR_WALLET}'`
    );

    await runQuery(
      "Q1d: Executor wallet (lowercase)",
      `SELECT COUNT(*) as count, 'Executor (lowercase)' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}')`
    );

    // Query 2: ERC20 transfers
    console.log("\n\n[QUERY 2] ERC20 Transfers Activity");
    console.log("-".repeat(80));

    await runQuery(
      "Q2a: Account wallet (from_address)",
      `SELECT COUNT(*) as count, 'Account (from)' as type FROM erc20_transfers_decoded WHERE LOWER(from_address) = LOWER('${ACCOUNT_WALLET}')`
    );

    await runQuery(
      "Q2b: Account wallet (to_address)",
      `SELECT COUNT(*) as count, 'Account (to)' as type FROM erc20_transfers_decoded WHERE LOWER(to_address) = LOWER('${ACCOUNT_WALLET}')`
    );

    await runQuery(
      "Q2c: Executor wallet (from_address)",
      `SELECT COUNT(*) as count, 'Executor (from)' as type FROM erc20_transfers_decoded WHERE LOWER(from_address) = LOWER('${EXECUTOR_WALLET}')`
    );

    await runQuery(
      "Q2d: Executor wallet (to_address)",
      `SELECT COUNT(*) as count, 'Executor (to)' as type FROM erc20_transfers_decoded WHERE LOWER(to_address) = LOWER('${EXECUTOR_WALLET}')`
    );

    // Query 3: Transaction hash overlap
    console.log("\n\n[QUERY 3] Transaction Hash Overlap");
    console.log("-".repeat(80));

    await runQuery(
      "Q3a: Account wallet transaction_hash count",
      `SELECT COUNT(DISTINCT transaction_hash) as tx_count, 'Account' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${ACCOUNT_WALLET}')`
    );

    await runQuery(
      "Q3b: Executor wallet transaction_hash count",
      `SELECT COUNT(DISTINCT transaction_hash) as tx_count, 'Executor' as type FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}')`
    );

    await runQuery(
      "Q3c: Overlapping transaction_hash count",
      `
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
      `
    );

    // Query 4: Xi market condition_id for executor
    console.log("\n\n[QUERY 4] Xi Market Condition Coverage");
    console.log("-".repeat(80));
    console.log(`Xi Market condition_id: ${XI_MARKET_CONDITION_ID}`);

    await runQuery(
      "Q4a: Executor trades in Xi market",
      `SELECT COUNT(*) as xi_trades FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${EXECUTOR_WALLET}') AND condition_id = '${XI_MARKET_CONDITION_ID}'`
    );

    await runQuery(
      "Q4b: Account trades in Xi market",
      `SELECT COUNT(*) as xi_trades FROM pm_trades_canonical_v3 WHERE LOWER(trader_address) = LOWER('${ACCOUNT_WALLET}') AND condition_id = '${XI_MARKET_CONDITION_ID}'`
    );

    // Query 5: Sample trades from executor
    console.log("\n\n[QUERY 5] Sample Trades from Executor (first 5)");
    console.log("-".repeat(80));

    await runQuery(
      "Q5: Sample executor trades",
      `
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
      `
    );

    // Query 6: Check for any direct references or mappings
    console.log("\n\n[QUERY 6] Check for Direct Wallet References");
    console.log("-".repeat(80));

    await runQuery(
      "Q6a: Account wallet in all sources",
      `
        SELECT 
          'pm_trades_canonical_v3' as source,
          COUNT(*) as count
        FROM pm_trades_canonical_v3
        WHERE trader_address ILIKE '%${ACCOUNT_WALLET.slice(-8)}%'
        UNION ALL
        SELECT 
          'erc20_transfers_decoded' as source,
          COUNT(*) as count
        FROM erc20_transfers_decoded
        WHERE from_address ILIKE '%${ACCOUNT_WALLET.slice(-8)}%' OR to_address ILIKE '%${ACCOUNT_WALLET.slice(-8)}%'
      `
    );

    // Query 7: Detailed trade volume comparison
    console.log("\n\n[QUERY 7] Detailed Trade Volume Comparison");
    console.log("-".repeat(80));

    await runQuery(
      "Q7: Trade volume by direction",
      `
        SELECT 
          LOWER(trader_address) as wallet,
          buy_sell_direction,
          COUNT(*) as trade_count,
          SUM(quantity) as total_quantity,
          AVG(price) as avg_price
        FROM pm_trades_canonical_v3
        WHERE LOWER(trader_address) IN (
          LOWER('${ACCOUNT_WALLET}'),
          LOWER('${EXECUTOR_WALLET}')
        )
        GROUP BY LOWER(trader_address), buy_sell_direction
        ORDER BY wallet, buy_sell_direction
      `
    );

    console.log("\n" + "=".repeat(80));
    console.log("VALIDATION COMPLETE");
    console.log("=".repeat(80));
  } catch (error) {
    console.error("Fatal error:", error);
  } finally {
    await client.close();
  }
}

runValidation();
