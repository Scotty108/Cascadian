#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const EOA = "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b";
const PROXY = "0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723";

async function main() {
  const client = getClickHouseClient()
  
  console.log(`\n🔍 ERC20 USDC CASHFLOW ANALYSIS FOR XCNSTRATEGY WALLET CLUSTER\n`);
  console.log(`EOA:   ${EOA}`);
  console.log(`Proxy: ${PROXY}\n`);

  try {
    // Get summary statistics
    console.log("Querying ERC20 cashflow aggregates...\n");

    const statsResult = await client.query({
      query: `
        SELECT
          'Inflows' as direction,
          sum(amount_usdc) as total_usd,
          count() as transfer_count,
          count(distinct from_address) as unique_sources
        FROM default.erc20_transfers_decoded
        WHERE lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        AND lower(from_address) NOT IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        AND amount_usdc > 0
        UNION ALL
        SELECT
          'Outflows' as direction,
          sum(amount_usdc) as total_usd,
          count() as transfer_count,
          count(distinct to_address) as unique_sources
        FROM default.erc20_transfers_decoded
        WHERE lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        AND lower(to_address) NOT IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        AND amount_usdc > 0
      `,
      format: 'JSONEachRow'
    });

    const statsText = await statsResult.text();
    const statsLines = statsText.trim().split("\n").filter(l => l.length > 0);
    
    let totalInflows = 0;
    let totalOutflows = 0;
    let inflowCount = 0;
    let outflowCount = 0;

    console.log("═".repeat(70));
    console.log("📊 STABLECOIN CASHFLOW SUMMARY");
    console.log("═".repeat(70));

    for (const line of statsLines) {
      const record = JSON.parse(line);
      if (record.direction === 'Inflows') {
        totalInflows = parseFloat(record.total_usd) || 0;
        inflowCount = parseInt(record.transfer_count) || 0;
        console.log(`\nTotal USDC Inflows:   $${totalInflows.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
        console.log(`  Transfers: ${inflowCount}`);
        console.log(`  Unique sources: ${parseInt(record.unique_sources)}`);
      } else {
        totalOutflows = parseFloat(record.total_usd) || 0;
        outflowCount = parseInt(record.transfer_count) || 0;
        console.log(`\nTotal USDC Outflows:  $${totalOutflows.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
        console.log(`  Transfers: ${outflowCount}`);
        console.log(`  Unique destinations: ${parseInt(record.unique_sources)}`);
      }
    }

    const netFlow = totalInflows - totalOutflows;
    const totalVolume = totalInflows + totalOutflows;

    console.log(`\nNet USDC Flow:        $${netFlow.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    console.log(`Total Trading Volume: $${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    console.log(`Total Transfers:      ${inflowCount + outflowCount}`);

    // Get monthly breakdown
    console.log("\n" + "═".repeat(70));
    console.log("📅 MONTHLY BREAKDOWN");
    console.log("═".repeat(70));

    const monthlyResult = await client.query({
      query: `
        SELECT
          formatDateTime(block_time, '%Y-%m') as month,
          (
            SELECT sum(amount_usdc) 
            FROM default.erc20_transfers_decoded t2
            WHERE lower(t2.to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            AND lower(t2.from_address) NOT IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            AND formatDateTime(t2.block_time, '%Y-%m') = month
            AND t2.amount_usdc > 0
          ) as inflow_usd,
          (
            SELECT sum(amount_usdc) 
            FROM default.erc20_transfers_decoded t3
            WHERE lower(t3.from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            AND lower(t3.to_address) NOT IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            AND formatDateTime(t3.block_time, '%Y-%m') = month
            AND t3.amount_usdc > 0
          ) as outflow_usd,
          (
            SELECT count() 
            FROM default.erc20_transfers_decoded t4
            WHERE (
              lower(t4.to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
              OR lower(t4.from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            )
            AND formatDateTime(t4.block_time, '%Y-%m') = month
            AND t4.amount_usdc > 0
          ) as tx_count
        FROM (
          SELECT DISTINCT formatDateTime(block_time, '%Y-%m') as month
          FROM default.erc20_transfers_decoded
          WHERE (
            lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
            OR lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
          )
          AND amount_usdc > 0
          ORDER BY month DESC
        )
        ORDER BY month ASC
      `,
      format: 'JSONEachRow'
    });

    const monthlyText = await monthlyResult.text();
    const monthlyLines = monthlyText.trim().split("\n").filter(l => l.length > 0);

    console.log("\nMonth          In (USD)      Out (USD)     Net (USD)     Volume (USD)  Txs");
    console.log("─".repeat(80));

    for (const line of monthlyLines) {
      const record = JSON.parse(line);
      const inflow = parseFloat(record.inflow_usd) || 0;
      const outflow = parseFloat(record.outflow_usd) || 0;
      const net = inflow - outflow;
      const vol = inflow + outflow;
      const txCount = parseInt(record.tx_count);

      console.log(
        `${record.month}        ${inflow.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${outflow.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${net.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${vol.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${txCount.toString().padStart(4)}`
      );
    }

    // Get top partners
    console.log("\n" + "═".repeat(70));
    console.log("🔍 TOP 15 PARTNER ADDRESSES");
    console.log("═".repeat(70));

    const partnersResult = await client.query({
      query: `
        SELECT
          partner_addr,
          inflow_total,
          outflow_total,
          inflow_total + outflow_total as volume_total,
          tx_count
        FROM (
          SELECT
            lower(from_address) as partner_addr,
            0 as inflow_total,
            sum(amount_usdc) as outflow_total,
            count() as tx_count
          FROM default.erc20_transfers_decoded
          WHERE lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
          AND lower(from_address) NOT IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
          AND amount_usdc > 0
          GROUP BY partner_addr
          UNION ALL
          SELECT
            lower(to_address) as partner_addr,
            sum(amount_usdc) as inflow_total,
            0 as outflow_total,
            count() as tx_count
          FROM default.erc20_transfers_decoded
          WHERE lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
          AND lower(to_address) NOT IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
          AND amount_usdc > 0
          GROUP BY partner_addr
        )
        GROUP BY partner_addr
        ORDER BY volume_total DESC
        LIMIT 15
      `,
      format: 'JSONEachRow'
    });

    const partnersText = await partnersResult.text();
    const partnersLines = partnersText.trim().split("\n").filter(l => l.length > 0);

    console.log("\nPartner Address                In (USD)      Out (USD)      Volume (USD)  Txs");
    console.log("─".repeat(80));

    for (const line of partnersLines) {
      const record = JSON.parse(line);
      const inflow = parseFloat(record.inflow_total) || 0;
      const outflow = parseFloat(record.outflow_total) || 0;
      const volume = parseFloat(record.volume_total) || 0;
      const addr = record.partner_addr.substring(0, 8) + "..." + record.partner_addr.substring(34);

      console.log(
        `${addr.padEnd(36)} ${inflow.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${outflow.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(14)} ${volume.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(14)} ${record.tx_count.toString().padStart(4)}`
      );
    }

    // Get top individual transfers
    console.log("\n" + "═".repeat(70));
    console.log("🔝 TOP 20 LARGEST INDIVIDUAL TRANSFERS");
    console.log("═".repeat(70));

    const largeResult = await client.query({
      query: `
        SELECT
          block_time,
          lower(from_address) as from_a,
          lower(to_address) as to_a,
          amount_usdc,
          substring(tx_hash, 1, 10) as tx_short
        FROM default.erc20_transfers_decoded
        WHERE (
          lower(to_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
          OR lower(from_address) IN ('${EOA.toLowerCase()}', '${PROXY.toLowerCase()}')
        )
        AND amount_usdc > 0
        ORDER BY amount_usdc DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const largeText = await largeResult.text();
    const largeLines = largeText.trim().split("\n").filter(l => l.length > 0);

    console.log("\nAmount (USD)  Direction    Address                            Date");
    console.log("─".repeat(80));

    for (const line of largeLines) {
      const record = JSON.parse(line);
      const from = record.from_a.toLowerCase();
      const to = record.to_a.toLowerCase();
      const eoa_lower = EOA.toLowerCase();
      const proxy_lower = PROXY.toLowerCase();

      let direction = "?";
      let addr = "";

      if (from === eoa_lower || from === proxy_lower) {
        direction = "OUT";
        addr = to.substring(0, 8) + "..." + to.substring(34);
      } else {
        direction = "IN ";
        addr = from.substring(0, 8) + "..." + from.substring(34);
      }

      const date = record.block_time.split(" ")[0];
      const amount = parseFloat(record.amount_usdc).toLocaleString("en-US", { maximumFractionDigits: 2 });

      console.log(
        `${amount.padStart(12)}  ${direction}     ${addr.padEnd(36)} ${date}`
      );
    }

    // Final summary
    console.log("\n" + "═".repeat(70));
    console.log("📈 COMPARISON TO KNOWN VOLUMES");
    console.log("═".repeat(70));
    console.log(`\nPolymarket UI reported volume:        $1,383,851.59`);
    console.log(`PnL V2 canonical volume:               $225,572.34`);
    console.log(`ERC20 total stablecoin trading volume: $${totalVolume.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    
    const uiCoverage = (totalVolume / 1383851.59 * 100);
    const v2Coverage = (totalVolume / 225572.34 * 100);

    console.log(`\nCoverage Analysis:`);
    console.log(`  vs. UI volume:  ${uiCoverage.toFixed(2)}%`);
    console.log(`  vs. V2 volume:  ${v2Coverage.toFixed(2)}%`);

    if (totalVolume === 0) {
      console.log(`\n⚠️  CRITICAL FINDING: No ERC20 USDC transfers found for wallet cluster!`);
      console.log(`This suggests:`);
      console.log(`  1. Wallet may not have actually traded on Polymarket`);
      console.log(`  2. Trading may be done through intermediate contracts`);
      console.log(`  3. Data may be stored in different format/table`);
    } else if (uiCoverage < 10) {
      console.log(`\n⚠️  MAJOR GAP: ERC20 flows only ${uiCoverage.toFixed(1)}% of UI volume`);
      console.log(`The $${(1383851.59 - totalVolume).toLocaleString("en-US", { maximumFractionDigits: 2 })} gap suggests:`);
      console.log(`  1. Missing settlement/redemption flows`);
      console.log(`  2. Unrepresented trading activity in ERC20 data`);
      console.log(`  3. Data quality issues or missing contracts`);
    } else {
      console.log(`\n✓ ERC20 flows reasonably align with UI volume (${uiCoverage.toFixed(1)}%)`);
    }

    await client.close();
  } catch (e: any) {
    console.error('Error:', e.message)
    console.error(e)
  }
}

main()
