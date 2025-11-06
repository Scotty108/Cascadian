#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 180000,
});

async function main() {
  console.log(`\nCalculating USDC cash flows by proxy wallet...\n`);

  try {
    // Load active proxies
    console.log("Loading proxy wallets...");
    const proxRs = await ch.query({
      query: `
        SELECT proxy_wallet FROM pm_user_proxy_wallets
        WHERE is_active = 1
        FORMAT JSONEachRow
      `,
    });

    const proxText = await proxRs.text();
    const proxLines = proxText.trim().split("\n").filter((l) => l.length > 0);
    const proxies = new Set<string>();

    for (const line of proxLines) {
      const row = JSON.parse(line);
      proxies.add(row.proxy_wallet.toLowerCase());
    }

    console.log(`Loaded ${proxies.size} proxies\n`);

    // Fetch USDC transfers for these proxies
    console.log("Fetching USDC transfers from erc20_transfers...");
    const xfersRs = await ch.query({
      query: `
        SELECT
          lower(from_address) AS from_a,
          lower(to_address) AS to_a,
          value AS raw,
          block_time
        FROM erc20_transfers
        WHERE lower(contract) = {usdc:String}
        FORMAT JSONEachRow
      `,
      query_params: { usdc: USDC.toLowerCase() },
    });

    const xfersText = await xfersRs.text();
    const xfersLines = xfersText.trim().split("\n").filter((l) => l.length > 0);
    console.log(`Loaded ${xfersLines.length} USDC transfers\n`);

    // Aggregate by proxy
    type Flow = { in: bigint; out: bigint };
    const flows = new Map<string, Flow>();

    for (const line of xfersLines) {
      const r = JSON.parse(line);
      const toA = r.to_a.toLowerCase();
      const fromA = r.from_a.toLowerCase();
      const val = BigInt(r.raw);

      if (proxies.has(toA)) {
        const f = flows.get(toA) || { in: 0n, out: 0n };
        f.in += val;
        flows.set(toA, f);
      }
      if (proxies.has(fromA)) {
        const f = flows.get(fromA) || { in: 0n, out: 0n };
        f.out += val;
        flows.set(fromA, f);
      }
    }

    console.log(`✅ Calculated flows for ${flows.size} proxies\n`);

    // Sort by volume and display
    const sorted = Array.from(flows.entries())
      .map(([p, f]) => ({
        proxy: p,
        in: f.in,
        out: f.out,
        net: f.in - f.out,
        volume: f.in + f.out,
      }))
      .sort((a, b) => Number(b.volume - a.volume));

    console.log("📊 Top 20 proxies by USDC volume:\n");
    console.log("Proxy                                     In (USDC)      Out (USDC)      Net (USDC)      Volume");
    console.log("─".repeat(115));

    for (let i = 0; i < Math.min(20, sorted.length); i++) {
      const s = sorted[i];
      const inVal = (s.in / 1000000n).toString();
      const outVal = (s.out / 1000000n).toString();
      const netVal = (s.net / 1000000n).toString();
      const volVal = (s.volume / 1000000n).toString();

      console.log(
        `${s.proxy.padEnd(40)} ${inVal.padStart(14)} ${outVal.padStart(14)} ${netVal.padStart(14)} ${volVal.padStart(14)}`
      );
    }

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
