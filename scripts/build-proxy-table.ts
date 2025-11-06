#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import { resolveProxyViaAPI } from "../lib/polymarket/resolver";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 180000,
});

async function upsertProxy(p: {
  user_eoa: string;
  proxy_wallet: string;
  source: string;
}) {
  try {
    await ch.insert({
      table: "pm_user_proxy_wallets",
      values: [
        {
          user_eoa: p.user_eoa,
          proxy_wallet: p.proxy_wallet,
          source: p.source,
          last_seen_at: new Date(),
          is_active: 1,
        },
      ],
      format: "JSONEachRow",
    });
  } catch (e) {
    console.log(
      `Failed to upsert proxy for ${p.user_eoa}:`,
      (e as Error).message?.slice(0, 100)
    );
  }
}

async function main() {
  console.log(
    "Building proxy wallet map from EOAs in erc20_transfers...\n"
  );

  try {
    // Query distinct EOAs from erc20_transfers (finalized, decoded table)
    console.log("Fetching distinct EOAs from erc20_transfers...");
    const rs = await ch.query({
      query: `
        SELECT DISTINCT lower(from_address) AS eoa
        FROM erc20_transfers
        WHERE from_address NOT IN ('0x0000000000000000000000000000000000000000')
        ORDER BY eoa
        LIMIT 10000
        FORMAT JSONEachRow
      `,
    });

    const lines = await rs.text();
    const eoaLines = lines.trim().split("\n").filter((l) => l.length > 0);

    console.log(
      `Found ${eoaLines.length} distinct EOAs. Resolving proxies via API...\n`
    );

    let resolved = 0;
    let failed = 0;

    for (let i = 0; i < eoaLines.length; i++) {
      const row = JSON.parse(eoaLines[i]);
      const eoa = row.eoa;

      process.stdout.write(`\r[${i + 1}/${eoaLines.length}] Resolved: ${resolved}, Failed: ${failed}`);

      try {
        const info = await resolveProxyViaAPI(eoa);
        if (info) {
          await upsertProxy(info);
          resolved++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }

      // Rate limit API calls
      if ((i + 1) % 10 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(
      `\n\n✅ Complete: ${resolved} proxies resolved, ${failed} no data\n`
    );

    // Show what we got
    const checkRs = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_user_proxy_wallets WHERE is_active = 1 FORMAT JSONEachRow`,
    });
    const checkText = await checkRs.text();
    const checkRow = JSON.parse(checkText.trim());
    console.log(`Total proxies in table: ${checkRow.cnt}\n`);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
