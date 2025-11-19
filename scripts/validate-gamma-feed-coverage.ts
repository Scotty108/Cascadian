#!/usr/bin/env tsx
/**
 * Validate Gamma Feed Export vs Existing Resolution Tables
 *
 * Analyzes the 211,804 exported markets to determine:
 * 1. How many are already in our tables
 * 2. How many are unique additions
 * 3. Schema/data quality differences
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

interface GammaExport {
  export_date: string;
  total_markets: number;
  sources: {
    market_resolutions_final: number;
    resolutions_external_ingest: number;
  };
  markets: Array<{
    condition_id: string;
    question: string;
    payout_numerators: number[];
    payout_denominator: number;
    winning_index: number;
    source: string;
  }>;
}

async function validateCoverage() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('GAMMA FEED COVERAGE VALIDATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Load the exported JSON
    console.log('1️⃣  Loading resolved-from-gamma.json...\n');
    const exportData: GammaExport = JSON.parse(
      readFileSync('resolved-from-gamma.json', 'utf-8')
    );

    console.log(`Export Date: ${exportData.export_date}`);
    console.log(`Total Markets: ${exportData.total_markets.toLocaleString()}`);
    console.log(`Source Breakdown:`);
    console.log(`  - market_resolutions_final: ${exportData.sources.market_resolutions_final.toLocaleString()}`);
    console.log(`  - resolutions_external_ingest: ${exportData.sources.resolutions_external_ingest.toLocaleString()}\n`);

    // Get unique condition IDs from export
    const exportedIds = new Set(exportData.markets.map(m => m.condition_id.toLowerCase()));
    console.log(`Unique condition IDs in export: ${exportedIds.size.toLocaleString()}\n`);

    // Check what's already in our tables
    console.log('2️⃣  Checking existing coverage in ClickHouse...\n');

    const existingResult = await ch.query({
      query: `
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.market_resolutions_final
        UNION DISTINCT
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.resolutions_external_ingest
      `,
      format: 'JSONEachRow'
    });

    const existingData = await existingResult.json();
    const existingIds = new Set(existingData.map((row: any) => row.cid));

    console.log(`Unique condition IDs in ClickHouse: ${existingIds.size.toLocaleString()}\n`);

    // Calculate overlap
    console.log('3️⃣  Analyzing overlap...\n');

    let inBoth = 0;
    let onlyInExport = 0;
    const missingFromDb: string[] = [];

    for (const id of exportedIds) {
      if (existingIds.has(id)) {
        inBoth++;
      } else {
        onlyInExport++;
        if (missingFromDb.length < 100) {
          missingFromDb.push(id);
        }
      }
    }

    let onlyInDb = 0;
    for (const id of existingIds) {
      if (!exportedIds.has(id)) {
        onlyInDb++;
      }
    }

    console.log(`Markets in BOTH export and database: ${inBoth.toLocaleString()}`);
    console.log(`Markets ONLY in export (new): ${onlyInExport.toLocaleString()}`);
    console.log(`Markets ONLY in database (not closed): ${onlyInDb.toLocaleString()}\n`);

    const overlapPct = ((inBoth / exportedIds.size) * 100).toFixed(2);
    const newPct = ((onlyInExport / exportedIds.size) * 100).toFixed(2);

    console.log(`Overlap: ${overlapPct}%`);
    console.log(`New markets: ${newPct}%\n`);

    // Sample of missing markets
    if (missingFromDb.length > 0) {
      console.log('4️⃣  Sample of markets missing from database (first 10):\n');

      const samples = exportData.markets.filter(m =>
        missingFromDb.includes(m.condition_id.toLowerCase())
      ).slice(0, 10);

      samples.forEach((m, i) => {
        console.log(`${i + 1}. ${m.condition_id.substring(0, 16)}...`);
        console.log(`   Question: ${m.question.substring(0, 60)}...`);
        console.log(`   Payout: [${m.payout_numerators}] / ${m.payout_denominator}`);
        console.log(`   Winner: index ${m.winning_index}`);
        console.log(`   Source: ${m.source}\n`);
      });
    }

    // Data quality check: Compare payout vectors for overlap
    console.log('5️⃣  Data quality check (payout vector comparison)...\n');

    const sampleIds = Array.from(exportedIds).slice(0, 100);
    const sampleExportMap = new Map(
      exportData.markets
        .filter(m => sampleIds.includes(m.condition_id.toLowerCase()))
        .map(m => [m.condition_id.toLowerCase(), m])
    );

    const dbSampleResult = await ch.query({
      query: `
        SELECT
          lower(replaceAll(condition_id_norm, '0x', '')) as cid,
          payout_numerators,
          payout_denominator,
          winning_index
        FROM default.market_resolutions_final
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) IN (${sampleIds.map(id => `'${id}'`).join(',')})
        LIMIT 50
      `,
      format: 'JSONEachRow'
    });

    const dbSample = await dbSampleResult.json();
    let matches = 0;
    let mismatches = 0;

    dbSample.forEach((db: any) => {
      const exported = sampleExportMap.get(db.cid);
      if (exported) {
        const dbPayouts = db.payout_numerators.join(',');
        const exportPayouts = exported.payout_numerators.join(',');

        if (dbPayouts === exportPayouts &&
            db.payout_denominator === exported.payout_denominator &&
            db.winning_index === exported.winning_index) {
          matches++;
        } else {
          mismatches++;
        }
      }
    });

    console.log(`Sample comparison (${dbSample.length} markets):`);
    console.log(`  Exact matches: ${matches}`);
    console.log(`  Mismatches: ${mismatches}\n`);

    if (matches > 0) {
      console.log('✅ Payout vectors match between export and database\n');
    }
    if (mismatches > 0) {
      console.log('⚠️  Some payout vectors differ - may indicate data updates\n');
    }

    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (onlyInExport === 0) {
      console.log('✅ NO NEW MARKETS: All exported markets already in database');
      console.log('   → Gamma feed export is redundant with existing data');
      console.log('   → No ingestion needed\n');
    } else if (onlyInExport < 100) {
      console.log(`⚠️  MINIMAL NEW MARKETS: Only ${onlyInExport} markets missing`);
      console.log('   → Small gap, may not be worth ingestion overhead');
      console.log('   → Recommend: Manual review of missing markets\n');
    } else {
      console.log(`📊 SIGNIFICANT GAPS: ${onlyInExport.toLocaleString()} markets not in database`);
      console.log('   → Worth creating ingestion script');
      console.log('   → Recommend: Ingest unique markets only\n');
    }

    // Metadata analysis
    console.log('6️⃣  Metadata value analysis...\n');

    const hasDescriptions = exportData.markets.filter(m =>
      m.question && m.question.length > 0
    ).length;

    console.log(`Markets with question text: ${hasDescriptions.toLocaleString()} (${((hasDescriptions / exportData.markets.length) * 100).toFixed(2)}%)`);
    console.log('');
    console.log('Metadata fields from Gamma export:');
    console.log('  - condition_id ✅');
    console.log('  - question ✅ (human-readable)');
    console.log('  - payout_numerators ✅');
    console.log('  - payout_denominator ✅');
    console.log('  - winning_index ✅');
    console.log('');
    console.log('Additional metadata from Gamma API (not in export):');
    console.log('  - market_slug (URL-friendly)');
    console.log('  - description (long-form)');
    console.log('  - outcomes (array of outcome names)');
    console.log('  - volume, liquidity, end_date\n');

    // Recommendation
    console.log('═══════════════════════════════════════════════════════════');
    console.log('RECOMMENDATION');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (onlyInExport === 0) {
      console.log('✅ SKIP INGESTION');
      console.log('   Reason: No new data to add');
      console.log('   Action: Use existing resolution tables as-is\n');
    } else {
      console.log('📝 CREATE INGESTION SCRIPT');
      console.log('   Strategy:');
      console.log('   1. Filter to unique condition IDs not in existing tables');
      console.log('   2. Use COALESCE for canonical ID normalization');
      console.log(`   3. Insert ${onlyInExport.toLocaleString()} new markets`);
      console.log('   4. Validate with rowcount check\n');
    }

    return {
      exportCount: exportedIds.size,
      existingCount: existingIds.size,
      overlap: inBoth,
      newMarkets: onlyInExport,
      onlyInDb: onlyInDb,
      needsIngestion: onlyInExport > 0,
      missingIds: missingFromDb
    };

  } catch (error) {
    console.error('❌ Error validating coverage:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

validateCoverage().then(result => {
  if (result.needsIngestion) {
    console.log('\nNext step: Run create-ingestion-script.ts to generate ingest logic\n');
  }
});
