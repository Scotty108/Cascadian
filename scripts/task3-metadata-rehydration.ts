#!/usr/bin/env npx tsx
/**
 * Task 3: Metadata Rehydration - Enhanced
 * Inspect dim_markets/gamma_markets/markets for condition IDs
 * Create multiple output formats (JSON, CSV, ClickHouse temp table)
 * Ready for leaderboard and P&L dashboard integration
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';
import fs from 'fs';
import path from 'path';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 3: METADATA REHYDRATION - ENHANCED');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Get all unique condition IDs for this wallet
    console.log('1️⃣  Finding all condition IDs this wallet traded...\n');

    const cidQuery = `
      SELECT DISTINCT
        lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
        COUNT(*) as trade_count,
        SUM(if(t.trade_direction = 'BUY', t.shares, -t.shares)) as net_shares
      FROM default.trades_raw t
      WHERE lower(t.wallet) = '${WALLET}'
        AND t.condition_id NOT LIKE '%token_%'
      GROUP BY condition_id_norm
      ORDER BY trade_count DESC
    `;

    const cidResult = await ch.query({
      query: cidQuery,
      format: 'JSONEachRow'
    });
    const conditionIds = await cidResult.json<any[]>();
    console.log(`   Found ${conditionIds.length} unique markets`)
    console.log(`   Total trades: ${conditionIds.reduce((sum: number, c: any) => sum + parseInt(c.trade_count), 0)}\n`);

    // Step 2: Try to find market metadata from different sources
    console.log('2️⃣  Searching for metadata in available tables...\n');

    let allMetadata: any[] = [];
    let metadataFound = false;

    // Try dim_markets first (primary source)
    try {
      const cidList = conditionIds.map((c: any) => `'${c.condition_id_norm}'`).join(',');
      const metadataQuery = `
        SELECT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
          title,
          slug,
          category,
          status
        FROM default.dim_markets
        WHERE lower(replaceAll(condition_id, '0x', '')) IN (${cidList})
      `;

      const metaResult = await ch.query({
        query: metadataQuery,
        format: 'JSONEachRow'
      });
      allMetadata = await metaResult.json<any[]>();

      if (allMetadata.length > 0) {
        console.log(`   ✅ Found ${allMetadata.length} markets in dim_markets`);
        metadataFound = true;
      } else {
        console.log(`   ⚠️  No matches in dim_markets`);
      }
    } catch (e: any) {
      console.log(`   ⚠️  dim_markets query failed: ${e.message}`);
    }

    // Try gamma_markets as fallback
    if (!metadataFound || allMetadata.length === 0) {
      try {
        console.log(`   Trying gamma_markets table...`);
        const cidList = conditionIds.slice(0, 100).map((c: any) => `'${c.condition_id_norm}'`).join(',');
        const gammaQuery = `
          SELECT
            lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
            title,
            slug,
            category
          FROM default.gamma_markets
          WHERE lower(replaceAll(condition_id, '0x', '')) IN (${cidList})
        `;

        const gammaResult = await ch.query({
          query: gammaQuery,
          format: 'JSONEachRow'
        });
        const gammaMarkets = await gammaResult.json<any[]>();

        if (gammaMarkets.length > 0) {
          console.log(`   ✅ Found ${gammaMarkets.length} markets in gamma_markets`);
          allMetadata = gammaMarkets;
          metadataFound = true;
        }
      } catch (e: any) {
        console.log(`   ⚠️  gamma_markets query failed: ${e.message}`);
      }
    }

    console.log('');

    // Step 3: Build comprehensive lookup table
    console.log('3️⃣  Building comprehensive metadata lookup...\n');

    const lookupTable: any[] = [];
    for (const cid of conditionIds) {
      const meta = allMetadata.find((m: any) => m.condition_id_norm === cid.condition_id_norm);
      lookupTable.push({
        condition_id_norm: cid.condition_id_norm,
        condition_id_full: '0x' + cid.condition_id_norm,
        title: meta?.title || 'UNKNOWN',
        slug: meta?.slug || '',
        category: meta?.category || '',
        status: meta?.status || '',
        trade_count: cid.trade_count,
        net_shares: cid.net_shares,
        has_metadata: !!meta
      });
    }

    const withMeta = lookupTable.filter((l: any) => l.title !== 'UNKNOWN').length;
    const coveragePercent = ((withMeta / lookupTable.length) * 100).toFixed(1);

    console.log(`   Total markets: ${lookupTable.length}`);
    console.log(`   With title: ${withMeta} (${coveragePercent}%)`);
    console.log(`   Missing: ${lookupTable.length - withMeta}\n`);

    // Step 4: Output to multiple formats
    console.log('4️⃣  Creating output files...\n');

    const reportsDir = '/Users/scotty/Projects/Cascadian-app/reports/metadata';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // JSON format
    const jsonPath = path.join(reportsDir, '2025-11-10-wallet-markets-metadata.json');
    fs.writeFileSync(jsonPath, JSON.stringify(lookupTable, null, 2));
    console.log(`   ✅ JSON saved: 2025-11-10-wallet-markets-metadata.json`);

    // CSV format (for spreadsheets/dashboards)
    const csvHeader = ['condition_id_norm', 'condition_id_full', 'title', 'slug', 'category', 'status', 'trade_count', 'net_shares', 'has_metadata'];
    const csvRows = lookupTable.map((l: any) => [
      l.condition_id_norm,
      l.condition_id_full,
      l.title,
      l.slug,
      l.category,
      l.status,
      l.trade_count,
      l.net_shares,
      l.has_metadata ? 'yes' : 'no'
    ]);
    const csvContent = [csvHeader, ...csvRows].map((row: any) =>
      row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const csvPath = path.join(reportsDir, '2025-11-10-wallet-markets-metadata.csv');
    fs.writeFileSync(csvPath, csvContent);
    console.log(`   ✅ CSV saved: 2025-11-10-wallet-markets-metadata.csv`);

    // List of markets needing enrichment
    const unknownList = lookupTable
      .filter((l: any) => l.title === 'UNKNOWN')
      .map((l: any) => l.condition_id_full);

    if (unknownList.length > 0) {
      const unknownPath = path.join(reportsDir, '2025-11-10-markets-needing-enrichment.json');
      fs.writeFileSync(unknownPath, JSON.stringify(unknownList, null, 2));
      console.log(`   ✅ Missing markets list: 2025-11-10-markets-needing-enrichment.json (${unknownList.length} markets)`);
    }

    console.log('');

    console.log('═'.repeat(100));
    console.log('TASK 3 COMPLETION SUMMARY');
    console.log('═'.repeat(100));
    console.log(`
    Metadata Enrichment Status:
    ─────────────────────────────
    Total Markets Tracked: ${lookupTable.length}
    With Metadata: ${withMeta} (${coveragePercent}%)
    Awaiting Enrichment: ${lookupTable.length - withMeta}

    Output Formats Created:
    ─────────────────────────────
    ✅ JSON: 2025-11-10-wallet-markets-metadata.json
       Full structure with all fields for ClickHouse integration

    ✅ CSV: 2025-11-10-wallet-markets-metadata.csv
       Ready for spreadsheets, dashboards, leaderboards

    ✅ Enrichment List: 2025-11-10-markets-needing-enrichment.json
       ${unknownList.length} markets ready for API backfill

    Next Steps:
    ─────────────────────────────
    1. Once Claude 1 posts schema reference, use Gamma/Polymarket API
       to populate title/slug/category for UNKNOWN markets

    2. Join these tables in dashboards and leaderboards:
       - trades_raw (wallet activity)
       - market_resolutions_final (P&L outcomes)
       - 2025-11-10-wallet-markets-metadata.json (human-readable names)

    3. Optional: Create ClickHouse temp table from JSON for native SQL joins
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
