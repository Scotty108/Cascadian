#!/usr/bin/env npx tsx
/**
 * Extract Confirmed Resolved Condition IDs
 *
 * Produces JSON/CSV list of all condition IDs with confirmed resolutions
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
  request_timeout: 120000
});

async function main() {
  console.log('\n📋 EXTRACTING CONFIRMED RESOLVED CONDITION IDS\n');
  console.log('═'.repeat(80));

  // Query all resolved condition IDs from both sources
  console.log('\n1️⃣ Querying resolution tables...\n');

  const query = `
    SELECT DISTINCT
      condition_id_norm as condition_id,
      payout_numerators,
      payout_denominator,
      source,
      resolved_at
    FROM (
      SELECT
        lower(replaceAll(condition_id_norm, '0x', '')) as condition_id_norm,
        payout_numerators,
        payout_denominator,
        source,
        resolved_at
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
        AND length(payout_numerators) > 0

      UNION ALL

      SELECT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
        payout_numerators,
        payout_denominator,
        source,
        resolved_at
      FROM default.resolutions_external_ingest
      WHERE payout_denominator > 0
        AND length(payout_numerators) > 0
    )
    ORDER BY resolved_at DESC
  `;

  const result = await ch.query({
    query,
    format: 'JSONEachRow'
  });

  const resolvedMarkets = await result.json<any>();

  console.log(`  Found: ${resolvedMarkets.length.toLocaleString()} confirmed resolved markets\n`);

  // Generate JSON output
  console.log('2️⃣ Generating output files...\n');

  const jsonOutput = {
    generated_at: new Date().toISOString(),
    total_resolved: resolvedMarkets.length,
    data_sources: [
      'default.market_resolutions_final',
      'default.resolutions_external_ingest'
    ],
    markets: resolvedMarkets.map((m: any) => ({
      condition_id: m.condition_id,
      payout_numerators: m.payout_numerators,
      payout_denominator: m.payout_denominator,
      source: m.source,
      resolved_at: m.resolved_at
    }))
  };

  writeFileSync(
    'confirmed-resolved-markets.json',
    JSON.stringify(jsonOutput, null, 2)
  );

  console.log(`  ✅ JSON: confirmed-resolved-markets.json (${resolvedMarkets.length.toLocaleString()} markets)\n`);

  // Generate CSV output
  const csvLines = ['condition_id,payout_numerators,payout_denominator,source,resolved_at'];

  for (const market of resolvedMarkets) {
    const payoutStr = JSON.stringify(market.payout_numerators).replace(/,/g, ';');
    csvLines.push(
      `${market.condition_id},"${payoutStr}",${market.payout_denominator},${market.source},${market.resolved_at}`
    );
  }

  writeFileSync('confirmed-resolved-markets.csv', csvLines.join('\n'));

  console.log(`  ✅ CSV: confirmed-resolved-markets.csv (${resolvedMarkets.length.toLocaleString()} markets)\n`);

  // Generate simple ID list
  const simpleIds = resolvedMarkets.map((m: any) => m.condition_id);
  writeFileSync(
    'confirmed-resolved-ids-only.json',
    JSON.stringify(simpleIds, null, 2)
  );

  console.log(`  ✅ Simple list: confirmed-resolved-ids-only.json\n`);

  // Statistics
  console.log('═'.repeat(80));
  console.log('📊 STATISTICS\n');

  const sources: Record<string, number> = {};
  for (const market of resolvedMarkets) {
    sources[market.source] = (sources[market.source] || 0) + 1;
  }

  console.log('By source:');
  for (const [source, count] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count.toLocaleString()}`);
  }

  console.log('\n═'.repeat(80));
  console.log('✅ EXTRACTION COMPLETE\n');

  console.log('Files generated:');
  console.log('  1. confirmed-resolved-markets.json - Full data with payouts');
  console.log('  2. confirmed-resolved-markets.csv - CSV format');
  console.log('  3. confirmed-resolved-ids-only.json - Just the IDs\n');

  console.log(`Total confirmed resolved markets: ${resolvedMarkets.length.toLocaleString()}\n`);

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
