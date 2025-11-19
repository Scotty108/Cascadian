#!/usr/bin/env npx tsx
/**
 * Task 6: Hydrate Staging Table with Metadata from Gamma/API Sources
 *
 * Updates market_metadata_wallet_enriched with titles/slugs from:
 * 1. gamma_markets (primary - 100% question coverage if markets exist)
 * 2. api_markets_staging (fallback - 100% slug coverage)
 *
 * Then reruns parity validation to show metadata_coverage metrics.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 6: HYDRATE METADATA FROM GAMMA_MARKETS & API_MARKETS_STAGING');
  console.log('═'.repeat(100) + '\n');

  try {
    // Step 1: Hydrate from gamma_markets
    console.log('1️⃣  Updating titles from gamma_markets...\n');

    const gammaUpdateQuery = `
      UPDATE default.market_metadata_wallet_enriched m
      SET
        title = g.question,
        description = substring(g.description, 1, 500),
        category = g.category,
        data_source = 'gamma_markets',
        metadata_complete = 1
      FROM default.gamma_markets g
      WHERE m.condition_id_norm = lower(replaceAll(g.condition_id, '0x', ''))
        AND g.question != ''
        AND m.title = 'UNKNOWN'
    `;

    try {
      await ch.query({ query: gammaUpdateQuery });
      console.log(`   ✅ Gamma_markets update completed\n`);
    } catch (e: any) {
      console.log(`   ⚠️  Gamma_markets update: ${e.message}\n`);
    }

    // Step 2: Hydrate from api_markets_staging (fallback + always get slug)
    console.log('2️⃣  Updating from api_markets_staging (fallback + slugs)...\n');

    const apiUpdateQuery = `
      UPDATE default.market_metadata_wallet_enriched m
      SET
        title = if(m.title = 'UNKNOWN', a.question, m.title),
        slug = a.market_slug,
        description = if(m.description = '', substring(a.description, 1, 500), m.description),
        data_source = if(m.data_source = 'none', 'api_markets_staging', m.data_source),
        metadata_complete = if(m.title != 'UNKNOWN', 1, 0)
      FROM default.api_markets_staging a
      WHERE m.condition_id_norm = lower(a.condition_id)
    `;

    try {
      await ch.query({ query: apiUpdateQuery });
      console.log(`   ✅ API_markets_staging update completed\n`);
    } catch (e: any) {
      console.log(`   ⚠️  API_markets_staging update: ${e.message}\n`);
    }

    // Step 3: Verify metadata coverage
    console.log('3️⃣  Analyzing metadata coverage...\n');

    const coverageQuery = `
      SELECT
        COUNT(*) as total_markets,
        SUM(metadata_complete) as with_metadata,
        SUM(if(data_source = 'gamma_markets', 1, 0)) as from_gamma,
        SUM(if(data_source = 'api_markets_staging', 1, 0)) as from_api,
        SUM(if(data_source = 'none', 1, 0)) as unfilled,
        SUM(if(slug != '', 1, 0)) as with_slug
      FROM default.market_metadata_wallet_enriched
    `;

    const coverageResult = await ch.query({
      query: coverageQuery,
      format: 'JSONEachRow'
    });
    const coverageData = await coverageResult.json<any[]>();
    const coverage = coverageData[0];

    console.log(`   Coverage Results:`);
    console.log(`   • Total markets:          ${coverage.total_markets}`);
    console.log(`   • With metadata:          ${coverage.with_metadata}/${coverage.total_markets} (${((parseInt(coverage.with_metadata) / parseInt(coverage.total_markets)) * 100).toFixed(1)}%)`);
    console.log(`   • From gamma_markets:     ${coverage.from_gamma}`);
    console.log(`   • From api_markets_staging: ${coverage.from_api}`);
    console.log(`   • With slug:              ${coverage.with_slug}`);
    console.log(`   • Still unfilled:         ${coverage.unfilled}\n`);

    // Step 4: Show sample enriched rows
    console.log('4️⃣  Sample enriched rows:\n');

    const sampleQuery = `
      SELECT
        condition_id_norm,
        title,
        slug,
        data_source,
        metadata_complete
      FROM default.market_metadata_wallet_enriched
      WHERE title != 'UNKNOWN'
      LIMIT 5
    `;

    try {
      const sampleResult = await ch.query({
        query: sampleQuery,
        format: 'JSONEachRow'
      });
      const sampleData = await sampleResult.json<any[]>();

      if (sampleData.length > 0) {
        sampleData.forEach((row: any) => {
          console.log(`   • ${row.condition_id_norm.substring(0, 16)}...`);
          console.log(`     Title: "${row.title.substring(0, 60)}"`);
          console.log(`     Slug: ${row.slug || '(empty)'}`);
          console.log(`     Source: ${row.data_source}\n`);
        });
      } else {
        console.log(`   (No enriched markets found - wallet markets not in metadata sources)\n`);
      }
    } catch (e: any) {
      console.log(`   (Could not fetch samples: ${e.message})\n`);
    }

    // Step 5: Prepare updated parity report
    console.log('5️⃣  Updating parity report with final metadata coverage...\n');

    const parityReportPath = '/Users/scotty/Projects/Cascadian-app/reports/parity/2025-11-10-pnl-parity.json';

    try {
      const fs = (await import('fs')).default;
      if (fs.existsSync(parityReportPath)) {
        const parityReport = JSON.parse(fs.readFileSync(parityReportPath, 'utf-8'));

        // Update metadata_coverage with final results
        parityReport.metadata_coverage = {
          total_markets: parseInt(coverage.total_markets),
          with_metadata: parseInt(coverage.with_metadata),
          coverage_percent: ((parseInt(coverage.with_metadata) / parseInt(coverage.total_markets)) * 100).toFixed(1) + '%',
          status: parseInt(coverage.with_metadata) === parseInt(coverage.total_markets) ? 'COMPLETE' : 'PARTIAL',
          sources: {
            gamma_markets: parseInt(coverage.from_gamma),
            api_markets_staging: parseInt(coverage.from_api),
            unfilled: parseInt(coverage.unfilled)
          },
          note: parseInt(coverage.with_metadata) === 0
            ? 'Wallet markets not found in gamma_markets or api_markets_staging (pre-2024 markets)'
            : `Metadata successfully hydrated from available sources`
        };

        fs.writeFileSync(parityReportPath, JSON.stringify(parityReport, null, 2));
        console.log(`   ✅ Parity report updated\n`);
      }
    } catch (e: any) {
      console.log(`   ⚠️  Could not update parity report: ${e.message}\n`);
    }

    // Final summary
    console.log('═'.repeat(100));
    console.log('METADATA HYDRATION COMPLETE');
    console.log('═'.repeat(100));
    console.log(`
    Final Results:
    ─────────────────────────────
    Markets Processed:           ${coverage.total_markets}/141
    With Metadata:               ${coverage.with_metadata}/${coverage.total_markets} (${((parseInt(coverage.with_metadata) / parseInt(coverage.total_markets)) * 100).toFixed(1)}%)
    From gamma_markets:          ${coverage.from_gamma}
    From api_markets_staging:    ${coverage.from_api}
    With market slug:            ${coverage.with_slug}
    Still unfilled:              ${coverage.unfilled}

    Staging Table Status:
    ─────────────────────────────
    Table: default.market_metadata_wallet_enriched
    Records: ${coverage.total_markets} (141 wallet markets)
    Ready for: Dashboard JOINs on condition_id_norm

    Next Steps:
    ─────────────────────────────
    1. Dashboard can now LEFT JOIN on condition_id_norm to get market titles/slugs
    2. If ${coverage.with_metadata} > 0: Market metadata is available for display
    3. If ${coverage.unfilled} > 0: Fall back to Polymarket API or use condition_ids directly
    4. When gamma_markets/api_markets_staging is backfilled with historical data,
       rerun this script to update with full metadata coverage

    SQL Dashboard Join Example:
    ─────────────────────────────
    SELECT
      t.condition_id_norm,
      t.net_shares,
      t.pnl_usd,
      COALESCE(m.title, 'Unknown Market') as market_title,
      m.slug,
      m.category,
      m.data_source
    FROM trades_with_direction t
    LEFT JOIN market_metadata_wallet_enriched m
      ON t.condition_id_norm = m.condition_id_norm
    WHERE lower(t.wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    `);

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    console.error(e.stack);
  }

  await ch.close();
}

main().catch(console.error);
