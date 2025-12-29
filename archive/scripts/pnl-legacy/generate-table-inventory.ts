#!/usr/bin/env npx tsx
/**
 * Generate comprehensive inventory of all Polymarket tables in ClickHouse
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

interface TableInfo {
  name: string;
  engine: string;
  total_rows: number;
  total_bytes: number;
  columns: Array<{ name: string; type: string }>;
  sample: Record<string, any> | null;
  source?: string;
  purpose?: string;
}

// Known table metadata
const TABLE_METADATA: Record<string, { source: string; purpose: string }> = {
  pm_user_positions: {
    source: "Goldsky (blockchain indexer)",
    purpose: "User position snapshots with realized_pnl (BROKEN - accumulates trade profits)",
  },
  pm_trader_events_v2: {
    source: "Goldsky / CLOB API",
    purpose: "Raw trade events - buys and sells with USDC amounts and fees",
  },
  pm_token_to_condition_map_v3: {
    source: "Derived from blockchain events",
    purpose: "Maps token_id to condition_id and outcome_index (YES/NO)",
  },
  pm_condition_resolutions: {
    source: "Blockchain events (ConditionResolution)",
    purpose: "Resolution outcomes - which outcome won for each condition",
  },
  pm_ui_positions_new: {
    source: "Polymarket Data API",
    purpose: "UI-style positions with cash_pnl - EMPTY for many wallets",
  },
  pm_market_metadata_enriched: {
    source: "Polymarket API + AI enrichment",
    purpose: "Market metadata with categories, tags, and enriched fields",
  },
  pm_clob_fills: {
    source: "Polymarket CLOB API",
    purpose: "Order book fill events",
  },
  pm_wallet_pnl_PROVISIONAL: {
    source: "Derived view",
    purpose: "Aggregated wallet PnL from Goldsky (provisional)",
  },
};

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

  // Get columns
  const colsResult = await client.query({
    query: `DESCRIBE TABLE ${tableName}`,
    format: "JSONEachRow",
  });
  const columns = (await colsResult.json()) as Array<{ name: string; type: string }>;

  // Get sample (only for non-views with data)
  let sample: Record<string, any> | null = null;
  if (Number(info.total_rows) > 0 && info.engine !== "View") {
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

  const metadata = TABLE_METADATA[tableName];

  return {
    name: info.name,
    engine: info.engine,
    total_rows: Number(info.total_rows),
    total_bytes: Number(info.total_bytes),
    columns,
    sample,
    source: metadata?.source,
    purpose: metadata?.purpose,
  };
}

async function main() {
  // Get all PM tables
  const tablesResult = await client.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = currentDatabase()
        AND (name LIKE 'pm_%' OR name LIKE 'vw_%' OR name LIKE 'polymarket%')
      ORDER BY name
    `,
    format: "JSONEachRow",
  });
  const tableNames = ((await tablesResult.json()) as any[]).map((t) => t.name);

  console.log(`Found ${tableNames.length} Polymarket tables/views\n`);

  const tables: TableInfo[] = [];
  for (const name of tableNames) {
    try {
      const info = await getTableInfo(name);
      tables.push(info);
      console.log(`Processed: ${name} (${info.total_rows.toLocaleString()} rows)`);
    } catch (e: any) {
      console.log(`Error processing ${name}: ${e.message}`);
    }
  }

  // Generate markdown report
  let md = `# Polymarket ClickHouse Tables Inventory

**Generated:** ${new Date().toISOString()}
**Database:** ${process.env.CLICKHOUSE_DATABASE}
**Total Tables:** ${tables.length}

---

## Summary

| Table | Engine | Rows | Size | Source |
|-------|--------|------|------|--------|
`;

  for (const t of tables) {
    const sizeMB = (t.total_bytes / 1024 / 1024).toFixed(2);
    md += `| ${t.name} | ${t.engine} | ${t.total_rows.toLocaleString()} | ${sizeMB} MB | ${t.source || "Unknown"} |\n`;
  }

  md += `\n---\n\n## Detailed Table Documentation\n\n`;

  for (const t of tables) {
    md += `### ${t.name}\n\n`;
    md += `**Engine:** ${t.engine}\n`;
    md += `**Rows:** ${t.total_rows.toLocaleString()}\n`;
    md += `**Size:** ${(t.total_bytes / 1024 / 1024).toFixed(2)} MB\n`;
    if (t.source) {
      md += `**Source:** ${t.source}\n`;
    }
    if (t.purpose) {
      md += `**Purpose:** ${t.purpose}\n`;
    }
    md += `\n`;

    md += `#### Columns\n\n`;
    md += `| Column | Type |\n`;
    md += `|--------|------|\n`;
    for (const c of t.columns) {
      md += `| ${c.name} | \`${c.type}\` |\n`;
    }
    md += `\n`;

    if (t.sample) {
      md += `#### Sample Values\n\n`;
      md += "```json\n";
      // Truncate long values
      const truncated: Record<string, any> = {};
      for (const [k, v] of Object.entries(t.sample)) {
        if (typeof v === "string" && v.length > 100) {
          truncated[k] = v.substring(0, 100) + "...";
        } else {
          truncated[k] = v;
        }
      }
      md += JSON.stringify(truncated, null, 2);
      md += "\n```\n\n";
    }

    md += `---\n\n`;
  }

  // Add relationship diagram
  md += `## Table Relationships

### Core Data Flow

\`\`\`
pm_trader_events_v2 (raw trades)
    │
    ├── token_id ──────────────────┐
    │                              ▼
    │                   pm_token_to_condition_map_v3
    │                              │
    │                              ├── condition_id
    │                              │       │
    │                              │       ▼
    │                              │   pm_condition_resolutions
    │                              │   (who won YES/NO)
    │                              │
    ▼                              ▼
pm_user_positions          pm_market_metadata_enriched
(Goldsky PnL - broken)     (market info, categories)
\`\`\`

### Key Joins

1. **Trade to Condition:**
   \`\`\`sql
   pm_trader_events_v2 t
   JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
   \`\`\`

2. **Condition to Resolution:**
   \`\`\`sql
   pm_token_to_condition_map_v3 m
   JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
   \`\`\`

3. **Trade to Market Metadata:**
   \`\`\`sql
   pm_trader_events_v2 t
   JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
   JOIN pm_market_metadata_enriched meta ON m.condition_id = meta.condition_id
   \`\`\`

---

## Views (Computed)

`;

  const views = tables.filter((t) => t.engine === "View");
  for (const v of views) {
    md += `### ${v.name}\n\n`;
    if (v.purpose) {
      md += `${v.purpose}\n\n`;
    }
    md += `**Columns:** ${v.columns.map((c) => c.name).join(", ")}\n\n`;
  }

  md += `---

## Data Quality Notes

### Known Issues

1. **pm_user_positions.realized_pnl** - Accumulates trade-level profits, causing 40x inflation for market makers
2. **pm_user_positions.unrealized_pnl** - Always 0 (not populated)
3. **pm_user_positions.total_sold** - Always 0 (not populated)
4. **pm_user_positions.condition_id** - Actually contains token_id in decimal format
5. **pm_ui_positions_new** - Empty for many wallets (backfill incomplete)

### Reliable Data Sources

1. **pm_trader_events_v2** - Most complete trade data
2. **pm_token_to_condition_map_v3** - Accurate token-to-condition mapping
3. **pm_condition_resolutions** - Accurate resolution outcomes

---

*Generated by generate-table-inventory.ts*
`;

  // Write to file
  const outputPath = resolve(process.cwd(), "docs/systems/database/POLYMARKET_TABLES_INVENTORY.md");
  fs.writeFileSync(outputPath, md);
  console.log(`\nReport written to: ${outputPath}`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
