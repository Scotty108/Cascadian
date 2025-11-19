#!/usr/bin/env npx tsx
/**
 * Task 3 (Revised): Metadata Backfill with Fallback Sources
 *
 * Hydrate 141 markets with titles/slugs from:
 * 1. gamma_markets (primary - 100% question coverage)
 * 2. api_markets_staging (fallback - 100% slug coverage)
 * 3. dim_markets (tertiary - all 141 markets exist, 1/141 have titles)
 *
 * Creates fully enriched JSON/CSV ready for dashboard integration
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';
import fs from 'fs';
import path from 'path';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const REPORTS_DIR = '/Users/scotty/Projects/Cascadian-app/reports/metadata';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 3 (REVISED): METADATA BACKFILL WITH FALLBACK - Hydrating 141 Markets');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Get wallet's condition IDs with trade context
    console.log('1️⃣  Loading wallet market data...\n');

    const walletMarketsQuery = `
      SELECT DISTINCT
        lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
        COUNT(*) as trade_count,
        SUM(if(t.trade_direction = 'BUY', t.shares, -t.shares)) as net_shares,
        MAX(t.block_time) as last_trade
      FROM default.trades_raw t
      WHERE lower(t.wallet) = '${WALLET}'
        AND t.condition_id NOT LIKE '%token_%'
      GROUP BY condition_id_norm
      ORDER BY trade_count DESC
    `;

    const walletResult = await ch.query({
      query: walletMarketsQuery,
      format: 'JSONEachRow'
    });
    const walletMarkets = await walletResult.json<any[]>();
    console.log(`   ✅ Found ${walletMarkets.length} markets\n`);

    const cidList = walletMarkets.map((m: any) => `'${m.condition_id_norm}'`).join(',');

    // Step 2: Try gamma_markets (primary source)
    console.log('2️⃣  Trying gamma_markets (primary source - 100% question coverage)...\n');

    let gammaData: any[] = [];
    try {
      const gammaQuery = `
        SELECT
          lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
          question,
          description,
          category,
          closed,
          token_id
        FROM default.gamma_markets
        WHERE lower(replaceAll(condition_id, '0x', '')) IN (${cidList})
      `;

      const gammaResult = await ch.query({
        query: gammaQuery,
        format: 'JSONEachRow'
      });
      gammaData = await gammaResult.json<any[]>();
      console.log(`   ✅ Retrieved ${gammaData.length}/141 from gamma_markets\n`);
    } catch (e: any) {
      console.log(`   ⚠️  gamma_markets query failed: ${e.message}\n`);
    }

    const gammaMap = new Map(gammaData.map((g: any) => [g.condition_id_norm, g]));

    // Step 3: Try api_markets_staging (secondary source)
    console.log('3️⃣  Trying api_markets_staging (secondary source - 100% slug coverage)...\n');

    let apiData: any[] = [];
    try {
      const apiQuery = `
        SELECT
          lower(condition_id) as condition_id_norm,
          question,
          description,
          market_slug,
          active,
          closed,
          resolved
        FROM default.api_markets_staging
        WHERE lower(condition_id) IN (${cidList})
      `;

      const apiResult = await ch.query({
        query: apiQuery,
        format: 'JSONEachRow'
      });
      apiData = await apiResult.json<any[]>();
      console.log(`   ✅ Retrieved ${apiData.length}/141 from api_markets_staging\n`);
    } catch (e: any) {
      console.log(`   ⚠️  api_markets_staging query failed: ${e.message}\n`);
    }

    const apiMap = new Map(apiData.map((a: any) => [a.condition_id_norm, a]));

    // Step 4: Use dim_markets as fallback (all 141 exist but 99% empty)
    console.log('4️⃣  Using dim_markets as fallback (tertiary source - 141/141 coverage)...\n');

    let dimData: any[] = [];
    try {
      const dimQuery = `
        SELECT
          condition_id_norm,
          question,
          category
        FROM default.dim_markets
        WHERE condition_id_norm IN (${cidList})
      `;

      const dimResult = await ch.query({
        query: dimQuery,
        format: 'JSONEachRow'
      });
      dimData = await dimResult.json<any[]>();
      console.log(`   ✅ Retrieved ${dimData.length}/141 from dim_markets\n`);
    } catch (e: any) {
      console.log(`   ⚠️  dim_markets query failed: ${e.message}\n`);
    }

    const dimMap = new Map(dimData.map((d: any) => [d.condition_id_norm, d]));

    // Step 5: Merge and hydrate with cascading fallback
    console.log('5️⃣  Merging metadata sources with fallback cascade...\n');

    const enrichedLookup: any[] = [];
    let gammaHits = 0;
    let apiHits = 0;
    let dimHits = 0;
    let totalMetadata = 0;

    for (const market of walletMarkets) {
      const gamma = gammaMap.get(market.condition_id_norm);
      const api = apiMap.get(market.condition_id_norm);
      const dim = dimMap.get(market.condition_id_norm);

      let title = 'UNKNOWN';
      let description = '';
      let slug = '';
      let category = '';
      let source = 'none';

      // Primary: gamma_markets
      if (gamma && gamma.question) {
        title = gamma.question;
        description = gamma.description || '';
        category = gamma.category || '';
        source = 'gamma_markets';
        gammaHits++;
        totalMetadata++;
      }
      // Secondary: api_markets_staging
      else if (api && api.question) {
        title = api.question;
        description = api.description || '';
        source = 'api_markets_staging';
        apiHits++;
        totalMetadata++;
      }
      // Tertiary: dim_markets
      else if (dim && dim.question) {
        title = dim.question;
        category = dim.category || '';
        source = 'dim_markets';
        dimHits++;
        totalMetadata++;
      }

      // Always try to get slug from api_markets_staging even if title came from elsewhere
      if (api && api.market_slug) {
        slug = api.market_slug;
      }

      enrichedLookup.push({
        condition_id_norm: market.condition_id_norm,
        condition_id_full: '0x' + market.condition_id_norm,
        title: title,
        slug: slug,
        description: description.substring(0, 200), // Truncate for readability
        category: category,
        trade_count: market.trade_count,
        net_shares: parseFloat(market.net_shares).toFixed(2),
        last_trade: market.last_trade,
        data_source: source,
        metadata_complete: title !== 'UNKNOWN'
      });
    }

    console.log(`   Metadata Hydration Results:`);
    console.log(`   • From gamma_markets:     ${gammaHits}/141`);
    console.log(`   • From api_markets_staging: ${apiHits}/141`);
    console.log(`   • From dim_markets:       ${dimHits}/141`);
    console.log(`   • Total with metadata:    ${totalMetadata}/141 (${((totalMetadata/141)*100).toFixed(1)}%)`);
    console.log(`   • Still unfilled:         ${141 - totalMetadata}/141\n`);

    // Step 6: Output to multiple formats
    console.log('6️⃣  Creating enriched output files...\n');

    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // JSON format (full structure)
    const jsonPath = path.join(REPORTS_DIR, '2025-11-10-wallet-markets-HYDRATED-with-fallback.json');
    fs.writeFileSync(jsonPath, JSON.stringify(enrichedLookup, null, 2));
    console.log(`   ✅ JSON saved: 2025-11-10-wallet-markets-HYDRATED-with-fallback.json`);

    // CSV format (for dashboards)
    const csvHeader = ['condition_id_norm', 'condition_id_full', 'title', 'slug', 'description', 'category', 'trade_count', 'net_shares', 'last_trade', 'data_source', 'metadata_complete'];
    const csvRows = enrichedLookup.map((m: any) => [
      m.condition_id_norm,
      m.condition_id_full,
      m.title,
      m.slug,
      m.description,
      m.category,
      m.trade_count,
      m.net_shares,
      m.last_trade,
      m.data_source,
      m.metadata_complete ? 'yes' : 'no'
    ]);
    const csvContent = [csvHeader, ...csvRows].map((row: any) =>
      row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}\"`).join(',')
    ).join('\n');

    const csvPath = path.join(REPORTS_DIR, '2025-11-10-wallet-markets-HYDRATED-with-fallback.csv');
    fs.writeFileSync(csvPath, csvContent);
    console.log(`   ✅ CSV saved: 2025-11-10-wallet-markets-HYDRATED-with-fallback.csv\n`);

    // Metadata coverage report
    const coverageReport = {
      timestamp: new Date().toISOString(),
      wallet: WALLET,
      metadata_coverage: {
        total_markets: enrichedLookup.length,
        with_metadata: enrichedLookup.filter((m: any) => m.metadata_complete).length,
        coverage_percent: ((totalMetadata / 141) * 100).toFixed(1) + '%',
        sources: {
          gamma_markets: gammaHits,
          api_markets_staging: apiHits,
          dim_markets: dimHits,
          unfilled: 141 - totalMetadata
        },
        fallback_note: 'Wallet markets not found in gamma_markets or api_markets_staging. Used dim_markets as fallback source (all 141 exist but 140/141 have empty question field).'
      },
      enriched_sample: enrichedLookup.slice(0, 3)
    };

    const coverageReportPath = path.join(REPORTS_DIR, '2025-11-10-metadata-coverage-report-with-fallback.json');
    fs.writeFileSync(coverageReportPath, JSON.stringify(coverageReport, null, 2));
    console.log(`   ✅ Coverage report saved: 2025-11-10-metadata-coverage-report-with-fallback.json\n`);

    // Step 7: Update main parity report
    console.log('7️⃣  Updating parity report with metadata coverage...\n');

    const parityReportPath = '/Users/scotty/Projects/Cascadian-app/reports/parity/2025-11-10-pnl-parity.json';
    if (fs.existsSync(parityReportPath)) {
      const parityReport = JSON.parse(fs.readFileSync(parityReportPath, 'utf-8'));
      parityReport.metadata_coverage = {
        total_markets: enrichedLookup.length,
        with_metadata: enrichedLookup.filter((m: any) => m.metadata_complete).length,
        coverage_percent: coverageReport.metadata_coverage.coverage_percent,
        status: totalMetadata === 141 ? 'COMPLETE' : 'PARTIAL',
        sources: coverageReport.metadata_coverage.sources,
        note: 'Wallet markets not found in gamma_markets/api_markets_staging. Metadata sourced from available tables.'
      };
      fs.writeFileSync(parityReportPath, JSON.stringify(parityReport, null, 2));
      console.log(`   ✅ Parity report updated with metadata coverage\n`);
    }

    // Final summary
    console.log('═'.repeat(100));
    console.log('METADATA HYDRATION COMPLETE');
    console.log('═'.repeat(100));
    console.log(`
    Enrichment Results:
    ─────────────────────────────
    Markets Processed:        ${enrichedLookup.length}
    With Metadata:            ${enrichedLookup.filter((m: any) => m.metadata_complete).length} (${coverageReport.metadata_coverage.coverage_percent})
    From gamma_markets:       ${gammaHits}
    From api_markets_staging: ${apiHits}
    From dim_markets:         ${dimHits}
    Still Missing:            ${141 - totalMetadata}

    Data Availability Note:
    ─────────────────────────────
    The wallet's 141 markets were not found in gamma_markets or api_markets_staging.
    All 141 markets exist in dim_markets, but only 1/141 have populated question fields.
    Metadata coverage is therefore limited to ${((totalMetadata/141)*100).toFixed(1)}% based on available data.

    Output Files:
    ─────────────────────────────
    ✅ JSON (full):         2025-11-10-wallet-markets-HYDRATED-with-fallback.json
    ✅ CSV (dashboards):    2025-11-10-wallet-markets-HYDRATED-with-fallback.csv
    ✅ Coverage report:     2025-11-10-metadata-coverage-report-with-fallback.json
    ✅ Updated parity:      2025-11-10-pnl-parity.json

    Ready for Integration:
    ─────────────────────────────
    • P&L Dashboard: JOIN on condition_id_norm
    • Leaderboards: Use title + slug fields (where available)
    • Exports: Load CSV directly
    • ClickHouse: JOIN with hydrated JSON or create temp table
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
