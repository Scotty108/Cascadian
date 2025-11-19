#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const EOA = "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b";
const PROXY = "0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723";

async function main() {
  const client = getClickHouseClient()
  
  console.log(`\n🔍 CHECKING WALLET EXISTENCE IN KEY TABLES\n`);
  console.log(`EOA:   ${EOA}`);
  console.log(`Proxy: ${PROXY}\n`);

  try {
    // Check pm_trades_canonical_v2
    console.log("═".repeat(70));
    console.log("1. pm_trades_canonical_v2");
    console.log("═".repeat(70));

    const tradesResult = await client.query({
      query: `
        SELECT 
          count() as cnt,
          sum(size) as total_volume
        FROM pm_trades_canonical_v2
        WHERE lower(wallet) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
      `,
      format: 'JSONEachRow'
    });

    const tradesData = await tradesResult.json<any>();
    console.log(`Trades: ${parseInt(tradesData[0].cnt)}`);
    console.log(`Volume: $${parseFloat(tradesData[0].total_volume).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

    // Check ERC1155 transfers
    console.log("\n" + "═".repeat(70));
    console.log("2. erc1155_transfers");
    console.log("═".repeat(70));

    const erc1155Result = await client.query({
      query: `
        SELECT 
          count() as cnt,
          count(distinct transaction_hash) as tx_count
        FROM erc1155_transfers
        WHERE lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        OR lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
      `,
      format: 'JSONEachRow'
    });

    const erc1155Data = await erc1155Result.json<any>();
    console.log(`ERC1155 transfers: ${parseInt(erc1155Data[0].cnt)}`);
    console.log(`Transactions: ${parseInt(erc1155Data[0].tx_count)}`);

    // Check erc20_transfers table (not decoded)
    console.log("\n" + "═".repeat(70));
    console.log("3. erc20_transfers (not decoded)");
    console.log("═".repeat(70));

    const erc20Result = await client.query({
      query: `
        SELECT 
          count() as cnt
        FROM erc20_transfers
        WHERE lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        OR lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
      `,
      format: 'JSONEachRow'
    });

    const erc20Data = await erc20Result.json<any>();
    console.log(`ERC20 transfers: ${parseInt(erc20Data[0].cnt)}`);

    // Check erc20_transfers_decoded
    console.log("\n" + "═".repeat(70));
    console.log("4. erc20_transfers_decoded");
    console.log("═".repeat(70));

    const erc20DecodedResult = await client.query({
      query: `
        SELECT 
          count() as cnt
        FROM erc20_transfers_decoded
        WHERE lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        OR lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
      `,
      format: 'JSONEachRow'
    });

    const erc20DecodedData = await erc20DecodedResult.json<any>();
    console.log(`ERC20 decoded transfers: ${parseInt(erc20DecodedData[0].cnt)}`);

    // Check if wallet appears in proxy table
    console.log("\n" + "═".repeat(70));
    console.log("5. pm_user_proxy_wallets");
    console.log("═".repeat(70));

    const proxyTableResult = await client.query({
      query: `
        SELECT 
          COUNT(DISTINCT user_wallet) as users,
          COUNT(DISTINCT proxy_wallet) as proxies
        FROM pm_user_proxy_wallets
        WHERE user_wallet IN ('${EOA}', '${PROXY}')
        OR proxy_wallet IN ('${EOA}', '${PROXY}')
      `,
      format: 'JSONEachRow'
    });

    const proxyTableData = await proxyTableResult.json<any>();
    console.log(`Users matching wallet: ${parseInt(proxyTableData[0].users)}`);
    console.log(`Proxies matching wallet: ${parseInt(proxyTableData[0].proxies)}`);

    // Sample a wallet that has data to compare
    console.log("\n" + "═".repeat(70));
    console.log("6. SAMPLE: Comparing to a wallet with known data");
    console.log("═".repeat(70));

    const sampleResult = await client.query({
      query: `
        SELECT 
          lower(wallet) as wallet_addr,
          count() as trade_count,
          sum(size) as volume_usd
        FROM pm_trades_canonical_v2
        GROUP BY wallet_addr
        ORDER BY volume_usd DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const sampleData = await sampleResult.json<any>();
    console.log(`\nTop wallet by volume: ${sampleData[0].wallet_addr}`);
    console.log(`  Trades: ${parseInt(sampleData[0].trade_count)}`);
    console.log(`  Volume: $${parseFloat(sampleData[0].volume_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

    // Check a sample ERC20 wallet to see flow
    console.log("\n" + "═".repeat(70));
    console.log("7. SAMPLE: ERC20 activity pattern from another wallet");
    console.log("═".repeat(70));

    const erc20SampleResult = await client.query({
      query: `
        SELECT 
          lower(from_address) as addr,
          count() as outflows,
          sum(amount_usdc) as out_usd
        FROM erc20_transfers_decoded
        WHERE amount_usdc > 0
        GROUP BY addr
        ORDER BY out_usd DESC
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const erc20SampleData = await erc20SampleResult.json<any>();
    console.log(`\nTop ERC20 sender: ${erc20SampleData[0].addr}`);
    console.log(`  Outflows: ${parseInt(erc20SampleData[0].outflows)}`);
    console.log(`  Total sent: $${parseFloat(erc20SampleData[0].out_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

    console.log("\n" + "═".repeat(70));
    console.log("⚠️  CRITICAL FINDINGS");
    console.log("═".repeat(70));
    
    const tradesCount = parseInt(tradesData[0].cnt);
    const erc1155Count = parseInt(erc1155Data[0].cnt);
    const erc20Count = parseInt(erc20Data[0].cnt);
    const erc20DecodedCount = parseInt(erc20DecodedData[0].cnt);

    if (tradesCount === 0 && erc1155Count === 0 && erc20Count === 0) {
      console.log(`\nWallet has NO activity in any table!`);
      console.log(`This strongly suggests:`);
      console.log(`  1. The wallet address may be incorrect`);
      console.log(`  2. The wallet may not actually exist on-chain`);
      console.log(`  3. Activity may be under a different address`);
    } else if (tradesCount > 0 && erc20DecodedCount === 0) {
      console.log(`\nWallet has TRADES but NO ERC20 transfers!`);
      console.log(`This is unusual and suggests:`);
      console.log(`  1. Trade data is not connected to proper ERC20 flows`);
      console.log(`  2. ERC20 data may be incomplete/filtered`);
      console.log(`  3. Settlement may happen off-chain or through AMM`);
    }

    await client.close();
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

main()
