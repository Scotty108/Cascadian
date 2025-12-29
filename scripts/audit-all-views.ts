#!/usr/bin/env tsx
/**
 * Complete ClickHouse Views Audit
 *
 * Generates comprehensive inventory of ALL views with:
 * - Full CREATE definitions
 * - Dependencies
 * - Sample data
 * - Functional status
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
  rowCount?: number;
}

interface ColumnInfo {
  name: string;
  type: string;
  default_kind: string;
  default_expression: string;
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
    // Parse the TSV output - first line is the CREATE statement
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
          type,
          default_kind,
          default_expression
        FROM system.columns
        WHERE database = 'default' AND table = '${viewName}'
        ORDER BY position
      `,
      format: 'JSONEachRow',
    });

    return await result.json<ColumnInfo>();
  } catch (error) {
    console.error(`  ❌ Failed to get columns for ${viewName}:`, error instanceof Error ? error.message : String(error));
    return [];
  }
}

async function getSampleData(viewName: string): Promise<{ data: any[]; isWorking: boolean; error?: string; rowCount?: number }> {
  try {
    // First try to get a count
    let rowCount: number | undefined;
    try {
      const countResult = await clickhouse.query({
        query: `SELECT count() as cnt FROM ${viewName}`,
        format: 'JSONEachRow',
      });
      const countData = await countResult.json<{ cnt: string }>();
      rowCount = parseInt(countData[0]?.cnt || '0');
    } catch (countError) {
      // Count might fail for some views, that's ok
    }

    // Try to get sample data
    const result = await clickhouse.query({
      query: `SELECT * FROM ${viewName} LIMIT 5`,
      format: 'JSONEachRow',
    });

    const data = await result.json();
    return {
      data,
      isWorking: true,
      rowCount
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

  // Extract table/view names from the SELECT statement
  // This is a simplified regex - might not catch all cases
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
  console.log(`\n🔍 Auditing: ${viewName}`);

  const [createStatement, columns, sampleResult] = await Promise.all([
    getViewCreateStatement(viewName),
    getViewColumns(viewName),
    getSampleData(viewName),
  ]);

  const dependencies = extractDependencies(asSelect);

  const status = sampleResult.isWorking ? '✅' : '❌';
  console.log(`  ${status} ${sampleResult.isWorking ? 'Working' : 'Broken'}`);
  if (sampleResult.rowCount !== undefined) {
    console.log(`  📊 Rows: ${sampleResult.rowCount.toLocaleString()}`);
  }
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
    rowCount: sampleResult.rowCount,
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
    md += `- [${category}](#${category.toLowerCase()}) (${categoryViews.length} views)\n`;
  });

  md += `\n---\n\n`;

  // Detailed sections
  sortedCategories.forEach(([category, categoryViews]) => {
    md += `## ${category}\n\n`;

    categoryViews.forEach(view => {
      md += `### ${view.name}\n\n`;

      md += `**Status:** ${view.isWorking ? '✅ Working' : '❌ Broken'}\n`;
      md += `**Engine:** ${view.engine}\n`;

      if (view.rowCount !== undefined) {
        md += `**Row Count:** ${view.rowCount.toLocaleString()}\n`;
      }

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
        md += `**Sample Data:**\n\`\`\`json\n${JSON.stringify(view.sampleData.slice(0, 3), null, 2)}\n\`\`\`\n\n`;
      } else if (!view.isWorking && view.error) {
        md += `**Error:**\n\`\`\`\n${view.error}\n\`\`\`\n\n`;
      }

      md += `---\n\n`;
    });
  });

  return md;
}

function generateJSONReport(views: ViewInfo[]): string {
  return JSON.stringify({
    generated_at: new Date().toISOString(),
    total_views: views.length,
    working_views: views.filter(v => v.isWorking).length,
    broken_views: views.filter(v => !v.isWorking).length,
    views: views.map(v => ({
      name: v.name,
      engine: v.engine,
      category: categorizeView(v.name),
      is_working: v.isWorking,
      row_count: v.rowCount,
      dependencies: v.dependencies,
      columns: v.columns.map(c => ({ name: c.name, type: c.type })),
      create_statement: v.createStatement,
      sample_data: v.sampleData.slice(0, 2),
      error: v.error,
    })),
  }, null, 2);
}

async function main() {
  console.log('🔍 ClickHouse Views Audit\n');
  console.log('=' .repeat(80));

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

    const jsonReport = generateJSONReport(views);
    const jsonPath = join(docsDir, 'views-inventory.json');
    writeFileSync(jsonPath, jsonReport);
    console.log(`📄 JSON report: ${jsonPath}`);

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
