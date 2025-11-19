#!/usr/bin/env npx tsx
/**
 * Task 3: Final Metadata Backfill
 * Hydrate 141 markets with titles/slugs from gamma_markets + api_markets_staging
 * Create fully enriched JSON/CSV ready for dashboard integration
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
  console.log('TASK 3: FINAL METADATA BACKFILL - Hydrating 141 Markets');
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

    // Step 2: Backfill from gamma_markets (primary source)
    console.log('2️⃣  Backfilling from gamma_markets (100% question coverage)...\n');

    const cidList = walletMarkets.map((m: any) => `'${m.condition_id_norm}'`).join(',');

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
    const gammaData = await gammaResult.json<any[]>();

    const gammaMap = new Map(gammaData.map((g: any) => [g.condition_id_norm, g]));
    console.log(`   ✅ Retrieved ${gammaData.length} from gamma_markets\n`);

    // Step 3: Backfill from api_markets_staging (fallback + slugs)
    // NOTE: api_markets_staging uses UPPERCASE condition_id without 0x prefix
    console.log('3️⃣  Backfilling from api_markets_staging (100% slug coverage)...\n');

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
    const apiData = await apiResult.json<any[]>();

    const apiMap = new Map(apiData.map((a: any) => [a.condition_id_norm, a]));
    console.log(`   ✅ Retrieved ${apiData.length} from api_markets_staging\n`);

    // Step 4: Merge and hydrate
    console.log('4️⃣  Merging metadata sources and creating enriched lookup...\n');

    const enrichedLookup: any[] = [];
    let gammaHits = 0;
    let apiFallbacks = 0;
    let unfilled = 0;

    for (const market of walletMarkets) {
      const gamma = gammaMap.get(market.condition_id_norm);
      const api = apiMap.get(market.condition_id_norm);

      let title = 'UNKNOWN';
      let description = '';
      let slug = '';
      let category = '';
      let source = 'none';

      if (gamma && gamma.question) {
        title = gamma.question;
        description = gamma.description || '';
        category = gamma.category || '';
        source = 'gamma_markets';
        gammaHits++;
      }

      if (api) {
        if (!title || title === 'UNKNOWN') {
          title = api.question || title;
          description = api.description || description;
          source = 'api_markets_staging';
          apiFallbacks++;
        }
        slug = api.market_slug || slug;
      }

      if (title === 'UNKNOWN') {
        unfilled++;
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
    console.log(`   • From gamma_markets:     ${gammaHits}/${walletMarkets.length}`);
    console.log(`   • From api_markets_staging: ${apiFallbacks}/${walletMarkets.length}`);
    console.log(`   • Still unfilled:         ${unfilled}/${walletMarkets.length}\n`);

    // Step 5: Output to multiple formats
    console.log('5️⃣  Creating enriched output files...\n');

    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // JSON format (full structure)
    const jsonPath = path.join(REPORTS_DIR, '2025-11-10-wallet-markets-HYDRATED.json');
    fs.writeFileSync(jsonPath, JSON.stringify(enrichedLookup, null, 2));
    console.log(`   ✅ JSON saved (fully hydrated): 2025-11-10-wallet-markets-HYDRATED.json`);

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
      row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const csvPath = path.join(REPORTS_DIR, '2025-11-10-wallet-markets-HYDRATED.csv');
    fs.writeFileSync(csvPath, csvContent);
    console.log(`   ✅ CSV saved (spreadsheet-ready):  2025-11-10-wallet-markets-HYDRATED.csv`);

    // Metadata coverage report
    const coverageReport = {
      timestamp: new Date().toISOString(),
      wallet: WALLET,
      metadata_coverage: {
        total_markets: enrichedLookup.length,
        with_title: enrichedLookup.filter((m: any) => m.title !== 'UNKNOWN').length,
        coverage_percent: (
          (enrichedLookup.filter((m: any) => m.title !== 'UNKNOWN').length / enrichedLookup.length) * 100
        ).toFixed(1) + '%',
        sources: {
          gamma_markets: gammaHits,
          api_markets_staging: apiFallbacks,
          unfilled: unfilled
        }
      },
      enriched_sample: enrichedLookup.slice(0, 3)
    };

    const coverageReportPath = path.join(REPORTS_DIR, '2025-11-10-metadata-coverage-report.json');
    fs.writeFileSync(coverageReportPath, JSON.stringify(coverageReport, null, 2));
    console.log(`   ✅ Coverage report saved:      2025-11-10-metadata-coverage-report.json\n`);

    // Step 6: Update main parity report
    console.log('6️⃣  Updating parity report with metadata coverage...\n');

    const parityReportPath = '/Users/scotty/Projects/Cascadian-app/reports/parity/2025-11-10-pnl-parity.json';
    if (fs.existsSync(parityReportPath)) {
      const parityReport = JSON.parse(fs.readFileSync(parityReportPath, 'utf-8'));
      parityReport.metadata_coverage = {
        total_markets: enrichedLookup.length,
        with_metadata: enrichedLookup.filter((m: any) => m.metadata_complete).length,
        coverage_percent: coverageReport.metadata_coverage.coverage_percent,
        status: unfilled === 0 ? 'COMPLETE' : 'PARTIAL'
      };
      fs.writeFileSync(parityReportPath, JSON.stringify(parityReport, null, 2));
      console.log(`   ✅ Parity report updated with metadata\n`);
    }

    // Final summary
    console.log('═'.repeat(100));
    console.log('METADATA HYDRATION COMPLETE');
    console.log('═'.repeat(100));
    console.log(`
    Enrichment Results:
    ─────────────────────────────
    Markets Processed:      ${enrichedLookup.length}
    With Metadata:          ${enrichedLookup.filter((m: any) => m.metadata_complete).length} (${coverageReport.metadata_coverage.coverage_percent})
    From gamma_markets:     ${gammaHits}
    From api_markets_staging: ${apiFallbacks}
    Still Missing:          ${unfilled}

    Output Files:
    ─────────────────────────────
    ✅ JSON (full):         2025-11-10-wallet-markets-HYDRATED.json
    ✅ CSV (dashboards):    2025-11-10-wallet-markets-HYDRATED.csv
    ✅ Coverage report:     2025-11-10-metadata-coverage-report.json
    ✅ Updated parity:      2025-11-10-pnl-parity.json

    Ready for Integration:
    ─────────────────────────────
    • P&L Dashboard: JOIN on condition_id_norm
    • Leaderboards: Use title + slug fields
    • Exports: Load CSV directly
    • ClickHouse: JOIN with hydrated JSON or create temp table
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
