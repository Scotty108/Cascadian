#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function checkStatus() {
  console.log('\n📊 TABLE STATUS CHECK\n');

  const result = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM pm_market_metadata FINAL',
    format: 'JSONEachRow'
  });
  const data = await result.json<{ count: string }>();
  console.log(`Total markets in table: ${data[0].count}`);

  const versionResult = await clickhouse.query({
    query: `
      SELECT enrichment_version, COUNT(*) as count
      FROM pm_market_metadata FINAL
      GROUP BY enrichment_version
      ORDER BY enrichment_version
    `,
    format: 'JSONEachRow'
  });
  const versions = await versionResult.json<{ enrichment_version: number; count: string }>();
  console.log('\nEnrichment versions:');
  versions.forEach(v => {
    console.log(`  Version ${v.enrichment_version}: ${v.count} markets`);
  });
}

checkStatus().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
