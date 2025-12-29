#!/usr/bin/env tsx
/**
 * Fast ClickHouse Views Audit
 *
 * Generates comprehensive inventory of ALL views WITHOUT slow row counts
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
  sampleData: any[];
  isWorking: boolean;
  error?: string;
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

async function getSampleData(viewName: string): Promise<{ data: any[]; isWorking: boolean; error?: string }> {
  try {
    const result = await clickhouse.query({
      query: `SELECT * FROM ${viewName} LIMIT 3`,
      format: 'JSONEachRow',
    });

    const data = await result.json();
    return {
      data,
      isWorking: true
    };
  } catch (error) {
    return {
      data: [],
      isWorking: false,
      error: error instanceof Error ? error.message : String(error)
    };
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
  console.log(`🔍 Auditing: ${viewName}`);

  const [createStatement, columns, sampleResult] = await Promise.all([
    getViewCreateStatement(viewName),
    getViewColumns(viewName),
    getSampleData(viewName),
  ]);

  const dependencies = extractDependencies(asSelect);

  const status = sampleResult.isWorking ? '✅' : '❌';
  console.log(`  ${status} ${sampleResult.isWorking ? 'Working' : 'Broken'}`);
  if (dependencies.length > 0) {
    console.log(`  🔗 Dependencies: ${dependencies.join(', ')}`);
  }

  return {
    name: viewName,
    engine,
    as_select: asSelect,
    dependencies,
    createStatement,
    columns,
    sampleData: sampleResult.data,
    isWorking: sampleResult.isWorking,
    error: sampleResult.error,
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
  md += `**Total Views:** ${views.length}\n`;
  md += `**Working:** ${views.filter(v => v.isWorking).length}\n`;
  md += `**Broken:** ${views.filter(v => !v.isWorking).length}\n\n`;

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

      md += `**Status:** ${view.isWorking ? '✅ Working' : '❌ Broken'}\n`;
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

      // Sample data
      if (view.isWorking && view.sampleData.length > 0) {
        md += `**Sample Data (first 2 rows):**\n\`\`\`json\n${JSON.stringify(view.sampleData.slice(0, 2), null, 2)}\n\`\`\`\n\n`;
      } else if (!view.isWorking && view.error) {
        md += `**Error:**\n\`\`\`\n${view.error}\n\`\`\`\n\n`;
      }

      md += `---\n\n`;
    });
  });

  return md;
}

async function main() {
  console.log('🔍 ClickHouse Views Audit (Fast Mode)\n');
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
    console.log(`  Working: ${views.filter(v => v.isWorking).length}`);
    console.log(`  Broken: ${views.filter(v => !v.isWorking).length}`);

    // Generate reports
    const docsDir = join(process.cwd(), 'docs', 'systems', 'database');

    const markdownReport = generateMarkdownReport(views);
    const markdownPath = join(docsDir, 'VIEWS_INVENTORY.md');
    writeFileSync(markdownPath, markdownReport);
    console.log(`\n📄 Markdown report: ${markdownPath}`);

    // Print broken views if any
    const brokenViews = views.filter(v => !v.isWorking);
    if (brokenViews.length > 0) {
      console.log('\n⚠️  Broken Views:');
      brokenViews.forEach(v => {
        console.log(`  ❌ ${v.name}: ${v.error}`);
      });
    }

    console.log('\n✅ Audit complete!');

  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

main();
