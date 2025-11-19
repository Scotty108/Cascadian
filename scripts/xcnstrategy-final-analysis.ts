#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const EOA = "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b";
const PROXY = "0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723";

async function main() {
  const client = getClickHouseClient()
  
  console.log(`\n🔍 COMPREHENSIVE ERC20 CASHFLOW ANALYSIS FOR XCNSTRATEGY WALLET CLUSTER\n`);
  console.log(`EOA:   ${EOA}`);
  console.log(`Proxy: ${PROXY}\n`);

  try {
    // First check what trades exist for this wallet
    console.log("Step 1: Checking pm_trades_canonical_v2...\n");

    const tradesResult = await client.query({
      query: `
        SELECT 
          count() as trade_count,
          sum(cast(usd_value as Float64)) as total_volume,
          count(distinct transaction_hash) as tx_count,
          min(timestamp) as first_trade,
          max(timestamp) as last_trade
        FROM pm_trades_canonical_v2
        WHERE lower(wallet_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
      `,
      format: 'JSONEachRow'
    });

    const tradesData = await tradesResult.json<any>();
    const tradeCount = parseInt(tradesData[0].trade_count);
    const tradeVolume = parseFloat(tradesData[0].total_volume) || 0;
    const txCount = parseInt(tradesData[0].tx_count);

    console.log(`Trades found: ${tradeCount}`);
    console.log(`Transaction count: ${txCount}`);
    console.log(`Total volume: $${tradeVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    console.log(`Date range: ${tradesData[0].first_trade} to ${tradesData[0].last_trade}\n`);

    // Now check ERC20 transfers
    console.log("Step 2: Checking erc20_transfers_decoded...\n");

    const erc20Result = await client.query({
      query: `
        SELECT
          sum(case when lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}') then cast(amount_usdc as Float64) else 0 end) as inflow_usd,
          sum(case when lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}') then cast(amount_usdc as Float64) else 0 end) as outflow_usd,
          count(case when lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}') then 1 end) as inflow_count,
          count(case when lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}') then 1 end) as outflow_count
        FROM erc20_transfers_decoded
        WHERE (
          lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
          OR lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        )
        AND cast(amount_usdc as Float64) > 0
      `,
      format: 'JSONEachRow'
    });

    const erc20Data = await erc20Result.json<any>();
    const inflowUSD = parseFloat(erc20Data[0].inflow_usd) || 0;
    const outflowUSD = parseFloat(erc20Data[0].outflow_usd) || 0;
    const inflowCount = parseInt(erc20Data[0].inflow_count);
    const outflowCount = parseInt(erc20Data[0].outflow_count);
    const totalVolume = inflowUSD + outflowUSD;
    const netFlow = inflowUSD - outflowUSD;

    console.log(`═`.repeat(70));
    console.log(`STABLECOIN CASHFLOW SUMMARY`);
    console.log(`═`.repeat(70));
    console.log(`\nERC20 Inflows:   $${inflowUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${inflowCount} transfers)`);
    console.log(`ERC20 Outflows:  $${outflowUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })} (${outflowCount} transfers)`);
    console.log(`Net Flow:        $${netFlow.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    console.log(`Total Volume:    $${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })}\n`);

    console.log(`═`.repeat(70));
    console.log(`COMPARISON TO PM_TRADES_CANONICAL_V2`);
    console.log(`═`.repeat(70));
    console.log(`\nCanonical trade volume:  $${tradeVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    console.log(`ERC20 trading volume:    $${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    
    if (totalVolume > 0) {
      const ratio = (tradeVolume / totalVolume * 100);
      console.log(`Ratio (trades/ERC20):    ${ratio.toFixed(2)}%`);
    }

    if (tradeCount === 0) {
      console.log(`\n⚠️  CRITICAL: Zero trades recorded for this wallet cluster!`);
      console.log(`If ERC20 volume > 0, trading activity is not being captured in pm_trades_canonical_v2`);
    } else if (totalVolume === 0) {
      console.log(`\n⚠️  CRITICAL: Trades recorded but NO ERC20 transfers found!`);
      console.log(`${tradeCount} trades recorded but stablecoin flows missing from ERC20 data`);
    } else if (Math.abs(tradeVolume - totalVolume) > Math.max(tradeVolume, totalVolume) * 0.1) {
      console.log(`\n⚠️  SIGNIFICANT MISMATCH: ${Math.abs(tradeVolume - totalVolume).toLocaleString("en-US", { maximumFractionDigits: 2 })} difference`);
    } else {
      console.log(`\n✓ Trade volume and ERC20 flows reasonably aligned`);
    }

    // Get partner details
    if (totalVolume > 0) {
      console.log(`\n` + `═`.repeat(70));
      console.log(`TOP ERC20 TRANSFER PARTNERS (by volume)`);
      console.log(`═`.repeat(70));

      const partnersResult = await client.query({
        query: `
          SELECT partner_addr, direction, partner_volume
          FROM (
            SELECT 
              lower(from_address) as partner_addr,
              'outflow' as direction,
              sum(cast(amount_usdc as Float64)) as partner_volume,
              count() as cnt
            FROM erc20_transfers_decoded
            WHERE lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            AND cast(amount_usdc as Float64) > 0
            GROUP BY partner_addr
            UNION ALL
            SELECT 
              lower(to_address) as partner_addr,
              'inflow' as direction,
              sum(cast(amount_usdc as Float64)) as partner_volume,
              count() as cnt
            FROM erc20_transfers_decoded
            WHERE lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            AND cast(amount_usdc as Float64) > 0
            GROUP BY partner_addr
          )
          ORDER BY partner_volume DESC
          LIMIT 10
        `,
        format: 'JSONEachRow'
      });

      const partnersText = await partnersResult.text();
      const partnerLines = partnersText.trim().split("\n").filter(l => l.length > 0);

      console.log("\nAddress                            Direction    Volume (USD)");
      console.log("─".repeat(70));

      for (const line of partnerLines) {
        const record = JSON.parse(line);
        const addr = record.partner_addr.substring(0, 8) + "..." + record.partner_addr.substring(34);
        const vol = parseFloat(record.partner_volume).toLocaleString("en-US", { maximumFractionDigits: 2 });

        console.log(
          `${addr.padEnd(36)} ${record.direction.padEnd(12)} ${vol.padStart(14)}`
        );
      }
    }

    // Bottom line
    console.log(`\n` + `═`.repeat(70));
    console.log(`BOTTOM LINE`);
    console.log(`═`.repeat(70));

    if (tradeCount === 0 && totalVolume === 0) {
      console.log(`\n❌ NO DATA FOUND`);
      console.log(`This wallet has:`);
      console.log(`  • 0 trades in pm_trades_canonical_v2`);
      console.log(`  • 0 ERC20 transfers in erc20_transfers_decoded`);
      console.log(`\nWallet address may be incorrect or wallet may not exist on-chain.`);
    } else if (tradeCount === 0 && totalVolume > 0) {
      console.log(`\n⚠️  DATA QUALITY ISSUE`);
      console.log(`Trade data missing but ERC20 flows exist:`);
      console.log(`  • 0 trades recorded`);
      console.log(`  • $${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })} in ERC20 volume`);
      console.log(`\nTrade execution not being captured (missing from pm_trades_canonical_v2)`);
    } else if (tradeCount > 0 && totalVolume === 0) {
      console.log(`\n⚠️  CRITICAL MISMATCH`);
      console.log(`Trades recorded but no stablecoin flows:`);
      console.log(`  • ${tradeCount} trades recorded ($${tradeVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })})`);
      console.log(`  • 0 ERC20 transfers found`);
      console.log(`\nStablecoin settlement data not captured (missing from erc20_transfers_decoded)`);
    } else {
      console.log(`\n✓ DATA PRESENT`);
      console.log(`Both trade and ERC20 data available:`);
      console.log(`  • ${tradeCount} trades recorded ($${tradeVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })})`);
      console.log(`  • ${(inflowCount + outflowCount)} ERC20 transfers ($${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })})`);
      
      const discrepancy = Math.abs(tradeVolume - totalVolume);
      const threshold = Math.max(tradeVolume, totalVolume) * 0.1; // 10% threshold
      
      if (discrepancy < threshold) {
        console.log(`\nData is reasonably aligned (${(discrepancy / Math.max(tradeVolume, totalVolume) * 100).toFixed(1)}% difference)`);
      } else {
        console.log(`\nData shows significant mismatch: $${discrepancy.toLocaleString("en-US", { maximumFractionDigits: 2 })} gap`);
      }
    }

    await client.close();
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

main()
