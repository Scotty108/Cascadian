#!/usr/bin/env npx tsx
/**
 * Generate comprehensive schema documentation for the 5 core Polymarket tables
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";
import * as fs from "fs";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

const CORE_TABLES = [
  "pm_condition_resolutions",
  "pm_ctf_events",
  "pm_market_metadata",
  "pm_token_to_condition_map_v3",
  "pm_trader_events_v2",
];

interface TableInfo {
  name: string;
  engine: string;
  total_rows: number;
  total_bytes: number;
  columns: Array<{ name: string; type: string; default_type: string; default_expression: string }>;
  sample: Record<string, any> | null;
  create_statement?: string;
}

async function getTableInfo(tableName: string): Promise<TableInfo> {
  // Get basic info
  const infoResult = await client.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = '${tableName}'
    `,
    format: "JSONEachRow",
  });
  const info = ((await infoResult.json()) as any[])[0];

  // Get columns with more detail
  const colsResult = await client.query({
    query: `
      SELECT name, type, default_kind as default_type, default_expression
      FROM system.columns
      WHERE database = currentDatabase()
        AND table = '${tableName}'
      ORDER BY position
    `,
    format: "JSONEachRow",
  });
  const columns = (await colsResult.json()) as Array<{
    name: string;
    type: string;
    default_type: string;
    default_expression: string;
  }>;

  // Get sample rows (3 rows for better preview)
  let sample: Record<string, any> | null = null;
  if (Number(info.total_rows) > 0) {
    try {
      const sampleResult = await client.query({
        query: `SELECT * FROM ${tableName} LIMIT 1`,
        format: "JSONEachRow",
      });
      const samples = (await sampleResult.json()) as any[];
      if (samples.length > 0) {
        sample = samples[0];
      }
    } catch {
      // Skip on error
    }
  }

  // Get CREATE TABLE statement
  let create_statement: string | undefined;
  try {
    const createResult = await client.query({
      query: `SHOW CREATE TABLE ${tableName}`,
      format: "JSONEachRow",
    });
    const createRows = (await createResult.json()) as any[];
    if (createRows.length > 0) {
      create_statement = createRows[0].statement || createRows[0]["CREATE TABLE"];
    }
  } catch {
    // Skip
  }

  return {
    name: info.name,
    engine: info.engine,
    total_rows: Number(info.total_rows),
    total_bytes: Number(info.total_bytes),
    columns,
    sample,
    create_statement,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function truncateValue(value: any, maxLen: number = 80): string {
  if (value === null || value === undefined) return "NULL";
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.length > maxLen) {
    return str.substring(0, maxLen) + "...";
  }
  return str;
}

async function main() {
  console.log("Generating schema documentation for core tables...\n");

  const tables: TableInfo[] = [];
  for (const name of CORE_TABLES) {
    try {
      const info = await getTableInfo(name);
      tables.push(info);
      console.log(`Processed: ${name} (${info.total_rows.toLocaleString()} rows, ${formatBytes(info.total_bytes)})`);
    } catch (e: any) {
      console.log(`Error processing ${name}: ${e.message}`);
    }
  }

  // Generate markdown report
  let md = `# Polymarket Core Tables Schema

**Generated:** ${new Date().toISOString()}
**Database:** default
**Status:** Clean slate for new PnL engine

---

## Overview

These 5 core tables are the foundation for all Polymarket PnL calculations. All legacy tables and views have been archived to \`pm_archive\`.

| Table | Engine | Rows | Size | Purpose |
|-------|--------|------|------|---------|
`;

  const purposes: Record<string, string> = {
    pm_condition_resolutions: "Resolution outcomes - which outcome won for each condition",
    pm_ctf_events: "Conditional Token Framework events (splits, merges, redemptions)",
    pm_market_metadata: "Market info - questions, descriptions, outcomes, categories",
    pm_token_to_condition_map_v3: "Maps token_id to condition_id and outcome_index (YES=0/NO=1)",
    pm_trader_events_v2: "Raw trade events - buys/sells with USDC amounts and fees",
  };

  for (const t of tables) {
    md += `| ${t.name} | ${t.engine} | ${t.total_rows.toLocaleString()} | ${formatBytes(t.total_bytes)} | ${purposes[t.name] || "—"} |\n`;
  }

  md += `\n---\n\n`;

  // Detailed documentation for each table
  for (const t of tables) {
    md += `## ${t.name}\n\n`;
    md += `**Engine:** \`${t.engine}\`\n`;
    md += `**Rows:** ${t.total_rows.toLocaleString()}\n`;
    md += `**Size:** ${formatBytes(t.total_bytes)}\n`;
    md += `**Purpose:** ${purposes[t.name] || "—"}\n\n`;

    // Columns table
    md += `### Columns\n\n`;
    md += `| Column | Type | Default |\n`;
    md += `|--------|------|---------|n`;
    for (const c of t.columns) {
      const defaultStr = c.default_expression ? `\`${c.default_expression}\`` : "—";
      md += `| ${c.name} | \`${c.type}\` | ${defaultStr} |\n`;
    }
    md += `\n`;

    // Sample data
    if (t.sample) {
      md += `### Sample Row\n\n`;
      md += `| Column | Sample Value |\n`;
      md += `|--------|-------------|\n`;
      for (const c of t.columns) {
        const value = t.sample[c.name];
        md += `| ${c.name} | \`${truncateValue(value)}\` |\n`;
      }
      md += `\n`;
    }

    md += `---\n\n`;
  }

  // Add relationship diagram
  md += `## Table Relationships

\`\`\`
                    pm_trader_events_v2
                    (269M raw trades)
                           │
                           │ token_id (decimal string)
                           ▼
              pm_token_to_condition_map_v3
              (maps token → condition + outcome)
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
pm_condition_resolutions  pm_market_metadata  pm_ctf_events
   (winning outcomes)      (market info)     (CTF operations)
\`\`\`

### Key Join Patterns

**1. Trade → Condition (most common)**
\`\`\`sql
SELECT t.*, m.condition_id, m.outcome_index
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m
  ON t.token_id = m.token_id_dec
\`\`\`

**2. Condition → Resolution**
\`\`\`sql
SELECT m.condition_id, r.payout_numerators
FROM pm_token_to_condition_map_v3 m
JOIN pm_condition_resolutions r
  ON m.condition_id = r.condition_id
\`\`\`

**3. Full Trade Context**
\`\`\`sql
SELECT
  t.proxy_wallet,
  t.token_id,
  t.side,
  t.usdc_amount,
  m.condition_id,
  m.outcome_index,
  meta.question,
  r.payout_numerators
FROM pm_trader_events_v2 t
JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
LEFT JOIN pm_market_metadata meta ON m.condition_id = meta.condition_id
LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
\`\`\`

---

## Key Field Formats

### Identifiers
- **condition_id:** 64-char hex (no 0x prefix), lowercase
- **token_id:** Decimal string in pm_trader_events_v2, maps via token_id_dec
- **proxy_wallet:** 42-char hex with 0x prefix, lowercase

### Units
- **usdc_amount:** In micro-USDC (divide by 1e6 for dollars)
- **fee_amount:** In micro-USDC
- **shares:** In base units (divide by 1e6 for display)

### Side Convention
- **side = 'BUY':** Trader bought outcome tokens (spent USDC)
- **side = 'SELL':** Trader sold outcome tokens (received USDC)

### Outcome Index
- **outcome_index = 0:** YES outcome
- **outcome_index = 1:** NO outcome

### Resolution Payouts
- **payout_numerators = '[1, 0]':** YES won
- **payout_numerators = '[0, 1]':** NO won
- **Empty/NULL:** Not yet resolved

---

## PnL Calculation Formula

For any wallet's PnL on a resolved condition:

\`\`\`sql
Net PnL =
  -- Money spent buying
  - SUM(CASE WHEN side = 'BUY' THEN (usdc_amount + fee_amount) / 1e6 ELSE 0 END)
  -- Money received selling
  + SUM(CASE WHEN side = 'SELL' THEN (usdc_amount - fee_amount) / 1e6 ELSE 0 END)
  -- Resolution payout (if won)
  + CASE WHEN won THEN final_shares * 1.0 ELSE 0 END
\`\`\`

Where:
- \`final_shares\` = shares bought - shares sold
- \`won\` = outcome_index matches winning payout index

---

*Generated by generate-core-tables-schema.ts*
`;

  // Write to file
  const outputPath = resolve(process.cwd(), "docs/systems/database/CORE_TABLES_SCHEMA.md");
  fs.writeFileSync(outputPath, md);
  console.log(`\nReport written to: ${outputPath}`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
