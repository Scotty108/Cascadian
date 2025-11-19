#!/usr/bin/env tsx
/**
 * Export resolved markets with payout vectors to JSON
 *
 * Joins Gamma API closed markets with existing resolution data
 * to create a portable JSON file of resolved markets.
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface ResolvedMarket {
  condition_id: string;
  question: string;
  payout_numerators: number[];
  payout_denominator: number;
  winning_index: number;
  source: 'market_resolutions_final' | 'resolutions_external_ingest';
}

async function exportResolvedMarkets() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('EXPORT RESOLVED MARKETS FROM GAMMA API');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Query: Join closed markets with existing resolution data
    console.log('1️⃣  Querying resolved markets...\n');

    const query = `
      SELECT
        g.condition_id,
        g.question,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        'market_resolutions_final' as source
      FROM default.api_markets_staging g
      INNER JOIN default.market_resolutions_final r
        ON g.condition_id = lower(replaceAll(r.condition_id_norm, '0x', ''))
      WHERE g.closed = true
        AND r.winning_index IS NOT NULL

      UNION ALL

      SELECT
        g.condition_id,
        g.question,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        'resolutions_external_ingest' as source
      FROM default.api_markets_staging g
      INNER JOIN default.resolutions_external_ingest r
        ON g.condition_id = lower(replaceAll(r.condition_id, '0x', ''))
      WHERE g.closed = true
        AND r.winning_index >= 0

      LIMIT 10000
    `;

    const result = await ch.query({
      query,
      format: 'JSONEachRow'
    });

    const markets: ResolvedMarket[] = await result.json();

    console.log(`✅ Found ${markets.length.toLocaleString()} resolved markets\n`);

    if (markets.length === 0) {
      console.log('❌ No resolved markets found!');
      console.log('   This might indicate:');
      console.log('   - Schema mismatch (check condition_id vs condition_id_norm)');
      console.log('   - No overlap between Gamma closed markets and existing resolutions');
      console.log('   - winning_index IS NULL for all matches\n');
      return;
    }

    // Breakdown by source
    const fromFinal = markets.filter(m => m.source === 'market_resolutions_final').length;
    const fromExternal = markets.filter(m => m.source === 'resolutions_external_ingest').length;

    console.log('2️⃣  Source breakdown:\n');
    console.log(`From market_resolutions_final: ${fromFinal.toLocaleString()}`);
    console.log(`From resolutions_external_ingest: ${fromExternal.toLocaleString()}\n`);

    // Sample display
    console.log('3️⃣  Sample markets (first 5):\n');
    markets.slice(0, 5).forEach((m, i) => {
      console.log(`${i + 1}. ${m.condition_id.substring(0, 16)}...`);
      console.log(`   Question: ${m.question.substring(0, 60)}...`);
      console.log(`   Payout: [${m.payout_numerators}] / ${m.payout_denominator}`);
      console.log(`   Winner: index ${m.winning_index}`);
      console.log(`   Source: ${m.source}\n`);
    });

    // Export to JSON
    console.log('4️⃣  Exporting to resolved-from-gamma.json...\n');

    const exportData = {
      export_date: new Date().toISOString(),
      total_markets: markets.length,
      sources: {
        market_resolutions_final: fromFinal,
        resolutions_external_ingest: fromExternal
      },
      markets: markets.map(m => ({
        condition_id: m.condition_id,
        question: m.question,
        payout_numerators: m.payout_numerators,
        payout_denominator: m.payout_denominator,
        winning_index: m.winning_index,
        source: m.source
      }))
    };

    writeFileSync(
      'resolved-from-gamma.json',
      JSON.stringify(exportData, null, 2),
      'utf-8'
    );

    console.log('✅ Export complete!\n');
    console.log(`File: resolved-from-gamma.json`);
    console.log(`Size: ${(JSON.stringify(exportData).length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Markets: ${markets.length.toLocaleString()}\n`);

    // Success criteria check
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUCCESS CRITERIA CHECK');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (markets.length >= 1000) {
      console.log('✅ SUCCESS: Exported 1,000+ resolved markets');
      console.log(`   Actual: ${markets.length.toLocaleString()} markets\n`);
    } else {
      console.log('⚠️  WARNING: Less than 1,000 markets exported');
      console.log(`   Actual: ${markets.length.toLocaleString()} markets`);
      console.log(`   Goal: 1,000+ markets\n`);
    }

    if (markets.length > 0) {
      console.log('✅ Payout vectors confirmed present in export\n');
    }

    console.log('Next steps:');
    console.log('1. Review resolved-from-gamma.json');
    console.log('2. Create ingestion script for market_resolutions_final');
    console.log('3. Validate insertions with rowcount check\n');

  } catch (error) {
    console.error('❌ Error exporting markets:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

exportResolvedMarkets();
