#!/usr/bin/env tsx
/**
 * Fast ClickHouse Views Audit - Definitions Only
 *
 * Gets view definitions without executing them
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface ViewInfo {
  name: string;
  engine: string;
  as_select: string;
  dependencies: string[];
  createStatement: string;
  columns: ColumnInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
}

async function listAllViews(): Promise<Array<{ name: string; engine: string; as_select: string }>> {
  console.log('📋 Listing all views...');

  const result = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        as_select
      FROM system.tables
      WHERE database = 'default'
        AND engine LIKE '%View%'
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });

  const views = await result.json<{ name: string; engine: string; as_select: string }>();
  console.log(`Found ${views.length} views\n`);

  return views;
}

async function getViewCreateStatement(viewName: string): Promise<string> {
  try {
    const result = await clickhouse.query({
      query: `SHOW CREATE TABLE ${viewName}`,
      format: 'TSV',
    });

    const text = await result.text();
    const lines = text.trim().split('\n');
    return lines[0] || '';
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function getViewColumns(viewName: string): Promise<ColumnInfo[]> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          name,
          type
        FROM system.columns
        WHERE database = 'default' AND table = '${viewName}'
        ORDER BY position
      `,
      format: 'JSONEachRow',
    });

    return await result.json<ColumnInfo>();
  } catch (error) {
    return [];
  }
}

function extractDependencies(asSelect: string): string[] {
  if (!asSelect) return [];

  const fromRegex = /FROM\s+([a-zA-Z0-9_]+)/gi;
  const joinRegex = /JOIN\s+([a-zA-Z0-9_]+)/gi;

  const dependencies = new Set<string>();

  let match;
  while ((match = fromRegex.exec(asSelect)) !== null) {
    dependencies.add(match[1]);
  }

  while ((match = joinRegex.exec(asSelect)) !== null) {
    dependencies.add(match[1]);
  }

  return Array.from(dependencies);
}

async function auditView(viewName: string, engine: string, asSelect: string): Promise<ViewInfo> {
  console.log(`🔍 ${viewName}`);

  const [createStatement, columns] = await Promise.all([
    getViewCreateStatement(viewName),
    getViewColumns(viewName),
  ]);

  const dependencies = extractDependencies(asSelect);

  return {
    name: viewName,
    engine,
    as_select: asSelect,
    dependencies,
    createStatement,
    columns,
  };
}

function categorizeView(viewName: string): string {
  const name = viewName.toLowerCase();

  if (name.includes('pnl') || name.includes('profit')) return 'PnL';
  if (name.includes('position')) return 'Positions';
  if (name.includes('trade') || name.includes('fill')) return 'Trades';
  if (name.includes('wallet') || name.includes('trader')) return 'Wallets';
  if (name.includes('metric')) return 'Metrics';
  if (name.includes('resolution') || name.includes('resolved')) return 'Resolutions';
  if (name.includes('market')) return 'Markets';
  if (name.includes('ledger')) return 'Ledger';
  if (name.includes('event')) return 'Events';
  if (name.includes('leaderboard')) return 'Leaderboard';

  return 'Other';
}

function generateMarkdownReport(views: ViewInfo[]): string {
  const timestamp = new Date().toISOString();

  let md = `# ClickHouse Views Inventory\n\n`;
  md += `**Generated:** ${timestamp}\n`;
  md += `**Total Views:** ${views.length}\n\n`;

  md += `---\n\n`;
  md += `## Table of Contents\n\n`;

  // Group by category
  const categories = new Map<string, ViewInfo[]>();
  views.forEach(view => {
    const category = categorizeView(view.name);
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(view);
  });

  // TOC
  const sortedCategories = Array.from(categories.entries()).sort(([a], [b]) => a.localeCompare(b));
  sortedCategories.forEach(([category, categoryViews]) => {
    md += `- [${category}](#${category.toLowerCase().replace(/\s+/g, '-')}) (${categoryViews.length} views)\n`;
  });

  md += `\n---\n\n`;

  // Detailed sections
  sortedCategories.forEach(([category, categoryViews]) => {
    md += `## ${category}\n\n`;

    categoryViews.forEach(view => {
      md += `### ${view.name}\n\n`;

      md += `**Engine:** ${view.engine}\n`;

      if (view.dependencies.length > 0) {
        md += `**Dependencies:** ${view.dependencies.join(', ')}\n`;
      }

      md += `\n`;

      // CREATE statement
      md += `**Definition:**\n\`\`\`sql\n${view.createStatement}\n\`\`\`\n\n`;

      // Columns
      if (view.columns.length > 0) {
        md += `**Columns:**\n\n`;
        md += `| Column | Type |\n`;
        md += `|--------|------|\n`;
        view.columns.forEach(col => {
          md += `| ${col.name} | ${col.type} |\n`;
        });
        md += `\n`;
      }

      md += `---\n\n`;
    });
  });

  return md;
}

async function main() {
  console.log('🔍 ClickHouse Views Audit (Definitions Only)\n');
  console.log('='.repeat(80));

  try {
    // List all views
    const viewsList = await listAllViews();

    // Audit each view
    const views: ViewInfo[] = [];
    for (const { name, engine, as_select } of viewsList) {
      const viewInfo = await auditView(name, engine, as_select);
      views.push(viewInfo);
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 Summary:');
    console.log(`  Total Views: ${views.length}`);

    // Generate reports
    const docsDir = join(process.cwd(), 'docs', 'systems', 'database');

    const markdownReport = generateMarkdownReport(views);
    const markdownPath = join(docsDir, 'VIEWS_INVENTORY.md');
    writeFileSync(markdownPath, markdownReport);
    console.log(`\n📄 Markdown report: ${markdownPath}`);

    console.log('\n✅ Audit complete!');

  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

main();
