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
    console.log(`\n${name}`);
    const result = await client.query({ query, format: "JSONEachRow" });
    const data = await result.json();
    console.log(JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return null;
  }
}

async function runValidation() {
  console.log("=".repeat(80));
  console.log("XCNSTRATEGY WALLET RELATIONSHIP VALIDATION");
  console.log("=".repeat(80));
  console.log(`Account Wallet: ${ACCOUNT_WALLET}`);
  console.log(`Executor Wallet: ${EXECUTOR_WALLET}`);
  console.log("=".repeat(80));

  try {
    // Query 1: Xi market trades for both wallets
    console.log("\n\n[QUERY 1] Xi Market Condition_ID Coverage");
    console.log("-".repeat(80));
    console.log(`Xi Market condition_id: ${XI_MARKET_CONDITION_ID}`);

    await runQuery(
      "Q1a: Executor trades in Xi market",
      `SELECT COUNT(*) as xi_trades, 'Executor' as wallet FROM pm_trades_canonical_v3 
       WHERE LOWER(wallet_address) = LOWER('${EXECUTOR_WALLET}') 
       AND condition_id_norm_v3 = '${XI_MARKET_CONDITION_ID}'`
    );

    await runQuery(
      "Q1b: Account trades in Xi market",
      `SELECT COUNT(*) as xi_trades, 'Account' as wallet FROM pm_trades_canonical_v3 
       WHERE LOWER(wallet_address) = LOWER('${ACCOUNT_WALLET}') 
       AND condition_id_norm_v3 = '${XI_MARKET_CONDITION_ID}'`
    );

    // Query 2: Detailed trade analysis with corrected column names
    console.log("\n\n[QUERY 2] Detailed Trade Volume Comparison");
    console.log("-".repeat(80));

    await runQuery(
      "Q2: Trade volume comparison",
      `
        SELECT 
          LOWER(wallet_address) as wallet,
          COUNT(*) as total_trades,
          COUNT(DISTINCT condition_id_norm_v3) as unique_markets,
          COUNT(DISTINCT transaction_hash) as unique_txs,
          SUM(shares) as total_shares,
          AVG(price) as avg_price,
          MIN(timestamp) as first_trade,
          MAX(timestamp) as last_trade
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) IN (
          LOWER('${ACCOUNT_WALLET}'),
          LOWER('${EXECUTOR_WALLET}')
        )
        GROUP BY LOWER(wallet_address)
      `
    );

    // Query 3: Sample trades from executor
    console.log("\n\n[QUERY 3] Sample Trades from Executor (first 10)");
    console.log("-".repeat(80));

    await runQuery(
      "Q3: Sample executor trades with timestamp and direction",
      `
        SELECT 
          wallet_address,
          condition_id_norm_v3,
          transaction_hash,
          trade_direction,
          shares,
          price,
          usd_value,
          timestamp
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${EXECUTOR_WALLET}')
        ORDER BY timestamp DESC
        LIMIT 10
      `
    );

    // Query 4: Sample trades from account
    console.log("\n\n[QUERY 4] Sample Trades from Account (first 10)");
    console.log("-".repeat(80));

    await runQuery(
      "Q4: Sample account trades with timestamp and direction",
      `
        SELECT 
          wallet_address,
          condition_id_norm_v3,
          transaction_hash,
          trade_direction,
          shares,
          price,
          usd_value,
          timestamp
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${ACCOUNT_WALLET}')
        ORDER BY timestamp DESC
        LIMIT 10
      `
    );

    // Query 5: Market distribution
    console.log("\n\n[QUERY 5] Market Distribution Analysis");
    console.log("-".repeat(80));

    await runQuery(
      "Q5a: Executor top 10 markets by trade count",
      `
        SELECT 
          condition_id_norm_v3,
          COUNT(*) as trade_count,
          COUNT(DISTINCT transaction_hash) as unique_txs,
          SUM(CAST(shares AS Float64)) as total_shares
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${EXECUTOR_WALLET}')
        GROUP BY condition_id_norm_v3
        ORDER BY trade_count DESC
        LIMIT 10
      `
    );

    await runQuery(
      "Q5b: Account top 10 markets by trade count",
      `
        SELECT 
          condition_id_norm_v3,
          COUNT(*) as trade_count,
          COUNT(DISTINCT transaction_hash) as unique_txs,
          SUM(CAST(shares AS Float64)) as total_shares
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${ACCOUNT_WALLET}')
        GROUP BY condition_id_norm_v3
        ORDER BY trade_count DESC
        LIMIT 10
      `
    );

    // Query 6: Trade direction distribution
    console.log("\n\n[QUERY 6] Trade Direction Analysis");
    console.log("-".repeat(80));

    await runQuery(
      "Q6a: Executor trade direction distribution",
      `
        SELECT 
          trade_direction,
          COUNT(*) as trade_count,
          SUM(CAST(shares AS Float64)) as total_shares,
          AVG(CAST(price AS Float64)) as avg_price
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${EXECUTOR_WALLET}')
        GROUP BY trade_direction
      `
    );

    await runQuery(
      "Q6b: Account trade direction distribution",
      `
        SELECT 
          trade_direction,
          COUNT(*) as trade_count,
          SUM(CAST(shares AS Float64)) as total_shares,
          AVG(CAST(price AS Float64)) as avg_price
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${ACCOUNT_WALLET}')
        GROUP BY trade_direction
      `
    );

    // Query 7: ERC20 activity summary
    console.log("\n\n[QUERY 7] ERC20 Transfer Activity Summary");
    console.log("-".repeat(80));

    await runQuery(
      "Q7: ERC20 transfer counts by wallet",
      `
        SELECT 
          LOWER(from_address) as wallet,
          'SENDER' as activity_type,
          COUNT(*) as transfer_count,
          SUM(CAST(amount AS Float64)) as total_amount
        FROM erc20_transfers_decoded
        WHERE LOWER(from_address) IN (LOWER('${ACCOUNT_WALLET}'), LOWER('${EXECUTOR_WALLET}'))
        GROUP BY LOWER(from_address)
        
        UNION ALL
        
        SELECT 
          LOWER(to_address) as wallet,
          'RECEIVER' as activity_type,
          COUNT(*) as transfer_count,
          SUM(CAST(amount AS Float64)) as total_amount
        FROM erc20_transfers_decoded
        WHERE LOWER(to_address) IN (LOWER('${ACCOUNT_WALLET}'), LOWER('${EXECUTOR_WALLET}'))
        GROUP BY LOWER(to_address)
      `
    );

    // Query 8: Temporal analysis
    console.log("\n\n[QUERY 8] Temporal Trading Analysis");
    console.log("-".repeat(80));

    await runQuery(
      "Q8a: Executor trading by month",
      `
        SELECT 
          toYYYYMM(timestamp) as month,
          COUNT(*) as trade_count,
          COUNT(DISTINCT transaction_hash) as unique_txs,
          MIN(timestamp) as first_trade,
          MAX(timestamp) as last_trade
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${EXECUTOR_WALLET}')
        GROUP BY toYYYYMM(timestamp)
        ORDER BY month DESC
        LIMIT 12
      `
    );

    await runQuery(
      "Q8b: Account trading by month",
      `
        SELECT 
          toYYYYMM(timestamp) as month,
          COUNT(*) as trade_count,
          COUNT(DISTINCT transaction_hash) as unique_txs,
          MIN(timestamp) as first_trade,
          MAX(timestamp) as last_trade
        FROM pm_trades_canonical_v3
        WHERE LOWER(wallet_address) = LOWER('${ACCOUNT_WALLET}')
        GROUP BY toYYYYMM(timestamp)
        ORDER BY month DESC
        LIMIT 12
      `
    );

    // Query 9: Check for any direct mappings or references between these wallets
    console.log("\n\n[QUERY 9] Cross-Reference Analysis");
    console.log("-".repeat(80));

    await runQuery(
      "Q9a: Shared transaction hashes",
      `
        WITH account_txs AS (
          SELECT DISTINCT transaction_hash 
          FROM pm_trades_canonical_v3
          WHERE LOWER(wallet_address) = LOWER('${ACCOUNT_WALLET}')
        )
        SELECT 
          COUNT(*) as shared_tx_count,
          COUNT(DISTINCT wallet_address) as distinct_wallets_in_shared_txs
        FROM pm_trades_canonical_v3
        WHERE transaction_hash IN (SELECT transaction_hash FROM account_txs)
      `
    );

    await runQuery(
      "Q9b: All wallets that share transactions with account wallet",
      `
        WITH account_txs AS (
          SELECT DISTINCT transaction_hash 
          FROM pm_trades_canonical_v3
          WHERE LOWER(wallet_address) = LOWER('${ACCOUNT_WALLET}')
        )
        SELECT 
          LOWER(wallet_address) as co_trader,
          COUNT(*) as trades_in_shared_txs,
          COUNT(DISTINCT transaction_hash) as shared_txs
        FROM pm_trades_canonical_v3
        WHERE transaction_hash IN (SELECT transaction_hash FROM account_txs)
        AND LOWER(wallet_address) != LOWER('${ACCOUNT_WALLET}')
        GROUP BY LOWER(wallet_address)
        ORDER BY trades_in_shared_txs DESC
        LIMIT 10
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
