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
  console.log(`Using: erc20_transfers_decoded (21.1M USDC transfers)\n`);

  try {
    // Now fetch USDC transfers for the wallet cluster
    console.log("Fetching USDC transfers for wallet cluster...\n");

    const query = `
      SELECT
        block_time,
        lower(from_address) as from_a,
        lower(to_address) as to_a,
        amount_usdc,
        tx_hash
      FROM default.erc20_transfers_decoded
      WHERE (
        lower(from_address) = {eoa:String}
        OR lower(to_address) = {eoa:String}
        OR lower(from_address) = {proxy:String}
        OR lower(to_address) = {proxy:String}
      )
      AND amount_usdc > 0
      ORDER BY block_time DESC
    `;

    const xfersResult = await client.query({
      query: query,
      query_params: {
        eoa: EOA.toLowerCase(),
        proxy: PROXY.toLowerCase(),
      },
      format: 'JSONEachRow'
    });

    const xfersText = await xfersResult.text();
    const xfersLines = xfersText
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    console.log(`Found ${xfersLines.length} USDC transfers\n`);

    // Parse and aggregate
    interface TransferRecord {
      timestamp: string;
      from_a: string;
      to_a: string;
      amount: number;
      tx: string;
    }

    const transfers: TransferRecord[] = [];
    let totalIn = 0;
    let totalOut = 0;

    const eoa_lower = EOA.toLowerCase();
    const proxy_lower = PROXY.toLowerCase();

    for (const line of xfersLines) {
      const r = JSON.parse(line);
      const from = r.from_a.toLowerCase();
      const to = r.to_a.toLowerCase();
      const amount = parseFloat(r.amount_usdc) || 0;

      transfers.push({
        timestamp: r.block_time,
        from_a: from,
        to_a: to,
        amount: amount,
        tx: r.tx_hash,
      });

      // Calculate inflows and outflows
      if ((to === eoa_lower || to === proxy_lower) && from !== eoa_lower && from !== proxy_lower) {
        totalIn += amount;
      }
      if ((from === eoa_lower || from === proxy_lower) && to !== eoa_lower && to !== proxy_lower) {
        totalOut += amount;
      }
    }

    const netFlow = totalIn - totalOut;

    console.log("═".repeat(70));
    console.log("📊 STABLECOIN CASHFLOW SUMMARY");
    console.log("═".repeat(70));
    console.log(`\nTotal USDC Inflows:  $${totalIn.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    console.log(
      `Total USDC Outflows: $${totalOut.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    );
    console.log(
      `Net USDC Flow:       $${netFlow.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    );
    console.log(`\nTotal Transfer Count: ${xfersLines.length}`);

    // Group by time period (month)
    console.log("\n" + "═".repeat(70));
    console.log("📅 MONTHLY BREAKDOWN");
    console.log("═".repeat(70));

    interface MonthlyRecord {
      in: number;
      out: number;
      count: number;
      transfers: TransferRecord[];
    }

    const monthlyData = new Map<string, MonthlyRecord>();

    for (const t of transfers) {
      const date = new Date(t.timestamp);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { in: 0, out: 0, count: 0, transfers: [] });
      }

      const monthly = monthlyData.get(monthKey)!;
      monthly.count++;
      monthly.transfers.push(t);

      if ((t.to_a === eoa_lower || t.to_a === proxy_lower) && t.from_a !== eoa_lower && t.from_a !== proxy_lower) {
        monthly.in += t.amount;
      }
      if ((t.from_a === eoa_lower || t.from_a === proxy_lower) && t.to_a !== eoa_lower && t.to_a !== proxy_lower) {
        monthly.out += t.amount;
      }
    }

    console.log("\nMonth          In (USD)      Out (USD)     Net (USD)     Volume (USD)  Txs");
    console.log("─".repeat(80));

    const months = Array.from(monthlyData.keys()).sort();
    for (const month of months) {
      const data = monthlyData.get(month)!;
      const volUSD = data.in + data.out;

      console.log(
        `${month}        ${data.in.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${data.out.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${(data.in - data.out).toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${volUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${data.count.toString().padStart(4)}`
      );
    }

    // Find largest transfers
    console.log("\n" + "═".repeat(70));
    console.log("🔝 TOP 20 LARGEST TRANSFERS");
    console.log("═".repeat(70));

    const sorted = transfers
      .sort((a, b) => b.amount - a.amount);

    console.log("\nAmount (USD)  Direction    From/To Address                    Timestamp");
    console.log("─".repeat(80));

    for (let i = 0; i < Math.min(20, sorted.length); i++) {
      const t = sorted[i];

      let direction = "?";
      let partner = "";

      if (t.from_a === eoa_lower || t.from_a === proxy_lower) {
        direction = "OUT";
        partner = t.to_a.substring(0, 8) + "..." + t.to_a.substring(34);
      } else {
        direction = "IN ";
        partner = t.from_a.substring(0, 8) + "..." + t.from_a.substring(34);
      }

      const timestamp = t.timestamp.split(" ")[0];
      console.log(
        `${t.amount.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(12)}  ${direction}     ${partner.padEnd(36)} ${timestamp}`
      );
    }

    // Look for patterns with specific addresses
    console.log("\n" + "═".repeat(70));
    console.log("🔍 PARTNER ADDRESS ANALYSIS (Top 15)");
    console.log("═".repeat(70));

    interface PartnerRecord {
      in: number;
      out: number;
      count: number;
      transfers: TransferRecord[];
    }

    const partnerData = new Map<string, PartnerRecord>();

    for (const t of transfers) {
      let partner = "";
      let isInflow = false;

      if (t.from_a === eoa_lower || t.from_a === proxy_lower) {
        partner = t.to_a;
        isInflow = false;
      } else {
        partner = t.from_a;
        isInflow = true;
      }

      if (!partnerData.has(partner)) {
        partnerData.set(partner, { in: 0, out: 0, count: 0, transfers: [] });
      }

      const pdata = partnerData.get(partner)!;
      pdata.count++;
      pdata.transfers.push(t);

      if (isInflow) {
        pdata.in += t.amount;
      } else {
        pdata.out += t.amount;
      }
    }

    const sortedPartners = Array.from(partnerData.entries())
      .map(([addr, data]) => ({
        address: addr,
        in: data.in,
        out: data.out,
        count: data.count,
        vol: data.in + data.out,
      }))
      .sort((a, b) => b.vol - a.vol);

    console.log("\nPartner Address                In (USD)      Out (USD)      Volume (USD)  Txs");
    console.log("─".repeat(80));

    for (let i = 0; i < Math.min(15, sortedPartners.length); i++) {
      const p = sortedPartners[i];

      const addr =
        p.address === "0x" ? "EOA->EOA" : p.address.substring(0, 8) + "..." + p.address.substring(34);

      console.log(
        `${addr.padEnd(36)} ${p.in.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${p.out.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(14)} ${p.vol.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(14)} ${p.count.toString().padStart(4)}`
      );
    }

    // Summary comparison
    console.log("\n" + "═".repeat(70));
    console.log("📈 COMPARISON TO KNOWN VOLUMES");
    console.log("═".repeat(70));
    console.log(`\nPolymarket UI reported volume:   $1,383,851.59`);
    console.log(`PnL V2 canonical volume:         $225,572.34`);
    console.log(
      `ERC20 total stablecoin volume:    $${(totalIn + totalOut).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    );
    console.log(`Coverage ratio: ${((totalIn + totalOut) / 1383851.59 * 100).toFixed(2)}% of UI volume`);
    console.log(`\nKey observations:`);
    console.log(`- ERC20 captures USDC money flows for trading`);
    console.log(`- Net flow indicates net deposits/withdrawals`);
    console.log(`- High in/out volume suggests active trading`);

    await client.close();
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

main()
