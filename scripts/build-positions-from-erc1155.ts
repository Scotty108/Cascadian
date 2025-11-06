#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import { pad32Hex, hexToUint256 } from "../lib/polymarket/resolver";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function main() {
  console.log("\nBuilding position flows from ERC1155 transfers...\n");

  try {
    // Fetch all flattened ERC1155 singles with market mapping
    console.log("Fetching ERC1155 single transfers from pm_erc1155_flats...");
    const logsRs = await ch.query({
      query: `
        SELECT
          erc.to_addr,
          erc.from_addr,
          erc.token_id,
          erc.amount,
          erc.block_time,
          m.market_id,
          m.outcome_label,
          m.outcome_index
        FROM pm_erc1155_flats erc
        LEFT JOIN pm_tokenid_market_map m ON erc.token_id = m.token_id
        WHERE length(erc.token_id) = 66
        FORMAT JSONEachRow
      `,
    });

    const logsText = await logsRs.text();
    const logLines = logsText.trim().split("\n").filter((l) => l.length > 0);
    console.log(`Loaded ${logLines.length} ERC1155 transfers with market context\n`);

    // Load active proxies
    console.log("Loading active proxy wallets...");
    const proxRs = await ch.query({
      query: `
        SELECT proxy_wallet FROM pm_user_proxy_wallets
        WHERE is_active = 1
        FORMAT JSONEachRow
      `,
    });

    const proxText = await proxRs.text();
    const proxLines = proxText.trim().split("\n").filter((l) => l.length > 0);
    const proxies = new Map<string, boolean>();

    for (const line of proxLines) {
      const row = JSON.parse(line);
      const p = row.proxy_wallet.toLowerCase();
      proxies.set(p, true);
      proxies.set(pad32Hex(p), true);
    }

    console.log(`Loaded ${proxies.size} proxies\n`);

    // Process logs
    type Position = {
      tokenId: string;
      qty: bigint;
      buys: bigint;
      sells: bigint;
      lastTx: string;
    };
    const byProxy = new Map<string, Map<string, Position>>();

    let matched = 0;

    for (const line of logLines) {
      const row = JSON.parse(line);
      const toAddr = row.to_addr.toLowerCase();
      const fromAddr = row.from_addr.toLowerCase();
      const tokenId = row.token_id.toLowerCase();
      const value = hexToUint256(row.amount);

      // Check if to or from is a known proxy
      let direction = 0;
      let proxyHit: string | null = null;

      if (proxies.has(toAddr)) {
        direction = 1;
        proxyHit = toAddr;
      } else if (proxies.has(fromAddr)) {
        direction = -1;
        proxyHit = fromAddr;
      }

      if (!proxyHit || direction === 0) continue;

      matched++;
      const bucket = byProxy.get(proxyHit) || new Map<string, Position>();
      const pos = bucket.get(tokenId) || {
        tokenId,
        qty: 0n,
        buys: 0n,
        sells: 0n,
        lastTx: "",
      };

      if (direction > 0) {
        pos.qty += value;
        pos.buys += value;
      } else {
        pos.qty -= value;
        pos.sells += value;
      }
      pos.lastTx = row.block_time;

      bucket.set(tokenId, pos);
      byProxy.set(proxyHit, bucket);

      if (matched % 50000 === 0) {
        process.stdout.write(`\rMatched: ${matched}, Proxies: ${byProxy.size}`);
      }
    }

    console.log(`\n\n✅ Matched ${matched} transfers across ${byProxy.size} proxies\n`);

    // Print summary for top proxies
    const sortedProxies = Array.from(byProxy.entries()).sort(
      (a, b) => b[1].size - a[1].size
    );

    console.log("📊 Top 20 proxies by position count:\n");
    for (let i = 0; i < Math.min(20, sortedProxies.length); i++) {
      const [proxy, positions] = sortedProxies[i];
      console.log(`${i + 1}. ${proxy} - ${positions.size} positions`);

      // Show top 5 positions for this proxy
      const topPos = Array.from(positions.values())
        .sort((a, b) => Number(b.buys - a.buys))
        .slice(0, 5);

      for (const p of topPos) {
        const net = p.qty;
        const direction = net > 0n ? "+" : "-";
        console.log(
          `     Token ${p.tokenId.slice(0, 10)}... qty=${direction}${Math.abs(Number(net))} buys=${p.buys} sells=${p.sells}`
        );
      }
      console.log("");
    }

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
