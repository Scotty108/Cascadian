#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
});

async function main() {
  const result = await client.query({
    query: `
      SELECT name, engine
      FROM system.tables
      WHERE database = 'default'
        AND (name LIKE 'pm_%' OR name LIKE 'vw_%')
      ORDER BY engine, name
    `,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as any[];

  console.log("Objects in default database:", rows.length);
  console.log("");
  console.log("TABLES:");
  const tables = rows.filter(r => !r.engine.includes("View"));
  for (const r of tables) {
    console.log(`  ${r.name} (${r.engine})`);
  }

  console.log("\nVIEWS:");
  const views = rows.filter(r => r.engine.includes("View"));
  for (const r of views) {
    console.log(`  ${r.name}`);
  }

  console.log("\n--- Summary ---");
  console.log(`Tables: ${tables.length}`);
  console.log(`Views: ${views.length}`);
  console.log(`Total: ${rows.length}`);

  await client.close();
}

main().catch(console.error);
