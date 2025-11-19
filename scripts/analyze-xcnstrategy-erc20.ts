#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";
const EOA = "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b";
const PROXY = "0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 180000,
});

async function main() {
  console.log(`\n🔍 ERC20 USDC CASHFLOW ANALYSIS FOR XCNSTRATEGY WALLET CLUSTER\n`);
  console.log(`EOA:   ${EOA}`);
  console.log(`Proxy: ${PROXY}\n`);

  try {
    // First, let's understand the schema
    console.log("Step 1: Checking ERC20 tables availability...\n");
    
    // Try different potential table names
    const tables = [
      "erc20_transfers",
      "erc20_transfers_staging",
      "erc20_transfers_decoded",
    ];

    let workingTable = null;
    for (const table of tables) {
      try {
        const result = await ch.query({
          query: `SELECT count() as c FROM default.${table} LIMIT 1`,
        });
        const data = await result.json<any>();
        const count = parseInt(data[0].c);
        console.log(`✓ ${table}: ${count.toLocaleString()} rows`);
        if (!workingTable) workingTable = table;
      } catch (e) {
        console.log(`✗ ${table}: Not available`);
      }
    }

    if (!workingTable) {
      console.error("\nNo ERC20 transfer table found!");
      process.exit(1);
    }

    console.log(`\nUsing table: ${workingTable}\n`);

    // Get schema
    console.log("Step 2: Analyzing schema...\n");
    const schemaResult = await ch.query({
      query: `SELECT * FROM default.${workingTable} LIMIT 1`,
      format: "JSONEachRow",
    });
    const schemaData = await schemaResult.json<any>();
    const fields = Object.keys(schemaData[0]);
    console.log("Available fields:", fields.join(", "), "\n");

    // Now fetch USDC transfers for the wallet cluster
    console.log("Step 3: Fetching USDC transfers for wallet cluster...\n");

    const query = `
      SELECT
        block_timestamp,
        lower(from_address) as from_a,
        lower(to_address) as to_a,
        value,
        transaction_hash
      FROM default.${workingTable}
      WHERE lower(contract) = {usdc:String}
      AND (
        lower(from_address) = {eoa:String}
        OR lower(to_address) = {eoa:String}
        OR lower(from_address) = {proxy:String}
        OR lower(to_address) = {proxy:String}
      )
      ORDER BY block_timestamp DESC
      FORMAT JSONEachRow
    `;

    const xfersResult = await ch.query({
      query: query,
      query_params: {
        usdc: USDC.toLowerCase(),
        eoa: EOA.toLowerCase(),
        proxy: PROXY.toLowerCase(),
      },
    });

    const xfersText = await xfersResult.text();
    const xfersLines = xfersText
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    console.log(`Found ${xfersLines.length} USDC transfers\n`);

    // Parse and aggregate
    type TransferRecord = {
      timestamp: string;
      from_a: string;
      to_a: string;
      raw: string;
      tx: string;
    };

    const transfers: TransferRecord[] = [];
    let totalIn = 0n;
    let totalOut = 0n;

    const eoa_lower = EOA.toLowerCase();
    const proxy_lower = PROXY.toLowerCase();

    for (const line of xfersLines) {
      const r = JSON.parse(line);
      const from = r.from_a.toLowerCase();
      const to = r.to_a.toLowerCase();
      const val = BigInt(r.value);

      transfers.push({
        timestamp: r.block_timestamp,
        from_a: from,
        to_a: to,
        raw: r.value,
        tx: r.transaction_hash,
      });

      // Calculate inflows and outflows
      if ((to === eoa_lower || to === proxy_lower) && from !== eoa_lower && from !== proxy_lower) {
        totalIn += val;
      }
      if ((from === eoa_lower || from === proxy_lower) && to !== eoa_lower && to !== proxy_lower) {
        totalOut += val;
      }
    }

    const netFlow = totalIn - totalOut;

    // Convert to USDC (6 decimals)
    const inUSDC = Number(totalIn) / 1e6;
    const outUSDC = Number(totalOut) / 1e6;
    const netUSDC = Number(netFlow) / 1e6;

    console.log("═".repeat(70));
    console.log("📊 STABLECOIN CASHFLOW SUMMARY");
    console.log("═".repeat(70));
    console.log(`\nTotal USDC Inflows:  $${inUSDC.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    console.log(
      `Total USDC Outflows: $${outUSDC.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    );
    console.log(
      `Net USDC Flow:       $${netUSDC.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    );
    console.log(`\nTotal Transfer Count: ${xfersLines.length}`);

    // Group by time period (month)
    console.log("\n" + "═".repeat(70));
    console.log("📅 MONTHLY BREAKDOWN");
    console.log("═".repeat(70));

    const monthlyData = new Map<
      string,
      { in: bigint; out: bigint; count: number; transfers: TransferRecord[] }
    >();

    for (const t of transfers) {
      const date = new Date(t.timestamp);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, { in: 0n, out: 0n, count: 0, transfers: [] });
      }

      const monthly = monthlyData.get(monthKey)!;
      monthly.count++;
      monthly.transfers.push(t);

      const val = BigInt(t.raw);
      if ((t.to_a === eoa_lower || t.to_a === proxy_lower) && t.from_a !== eoa_lower && t.from_a !== proxy_lower) {
        monthly.in += val;
      }
      if ((t.from_a === eoa_lower || t.from_a === proxy_lower) && t.to_a !== eoa_lower && t.to_a !== proxy_lower) {
        monthly.out += val;
      }
    }

    console.log("\nMonth          In (USD)      Out (USD)     Net (USD)     Volume (USD)  Txs");
    console.log("─".repeat(80));

    const months = Array.from(monthlyData.keys()).sort();
    for (const month of months) {
      const data = monthlyData.get(month)!;
      const inUSD = Number(data.in) / 1e6;
      const outUSD = Number(data.out) / 1e6;
      const netUSD = Number(data.in - data.out) / 1e6;
      const volUSD = Number(data.in + data.out) / 1e6;

      console.log(
        `${month}        ${inUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${outUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${netUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${volUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${data.count.toString().padStart(4)}`
      );
    }

    // Find largest transfers
    console.log("\n" + "═".repeat(70));
    console.log("🔝 TOP 15 LARGEST TRANSFERS");
    console.log("═".repeat(70));

    const sorted = transfers
      .map((t) => ({ ...t, value: Number(BigInt(t.raw)) / 1e6 }))
      .sort((a, b) => b.value - a.value);

    console.log("\nAmount (USD)  Direction    From/To Address                    Timestamp");
    console.log("─".repeat(80));

    for (let i = 0; i < Math.min(15, sorted.length); i++) {
      const t = sorted[i];
      const eoa_lower = EOA.toLowerCase();
      const proxy_lower = PROXY.toLowerCase();

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
        `${t.value.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(12)}  ${direction}     ${partner.padEnd(36)} ${timestamp}`
      );
    }

    // Look for patterns with specific addresses
    console.log("\n" + "═".repeat(70));
    console.log("🔍 PARTNER ADDRESS ANALYSIS");
    console.log("═".repeat(70));

    const partnerData = new Map<
      string,
      { in: bigint; out: bigint; count: number; transfers: TransferRecord[] }
    >();

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
        partnerData.set(partner, { in: 0n, out: 0n, count: 0, transfers: [] });
      }

      const pdata = partnerData.get(partner)!;
      pdata.count++;
      pdata.transfers.push(t);

      const val = BigInt(t.raw);
      if (isInflow) {
        pdata.in += val;
      } else {
        pdata.out += val;
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
      .sort((a, b) => Number(b.vol - a.vol));

    console.log("\nPartner Address                In (USD)      Out (USD)      Volume (USD)  Txs");
    console.log("─".repeat(80));

    for (let i = 0; i < Math.min(10, sortedPartners.length); i++) {
      const p = sortedPartners[i];
      const inUSD = Number(p.in) / 1e6;
      const outUSD = Number(p.out) / 1e6;
      const volUSD = Number(p.vol) / 1e6;

      const addr =
        p.address === "0x" ? "EOA->EOA" : p.address.substring(0, 8) + "..." + p.address.substring(34);

      console.log(
        `${addr.padEnd(36)} ${inUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(13)} ${outUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(14)} ${volUSD.toLocaleString("en-US", { maximumFractionDigits: 2 }).padStart(14)} ${p.count.toString().padStart(4)}`
      );
    }

    // Summary comparison
    console.log("\n" + "═".repeat(70));
    console.log("📈 COMPARISON TO KNOWN VOLUMES");
    console.log("═".repeat(70));
    console.log(`\nPolymarket UI reported volume:   $1,383,851.59`);
    console.log(`PnL V2 canonical volume:         $225,572.34`);
    console.log(
      `ERC20 total stablecoin volume:    $${(Number(totalIn + totalOut) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    );
    console.log(`\nNotes:`);
    console.log(`- ERC20 captures USDC money flows`);
    console.log(`- Trading volume may not equal USDC transfers (deposits/withdrawals)`);
    console.log(`- Proxy transfers to/from EOA may not count as trading`);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
