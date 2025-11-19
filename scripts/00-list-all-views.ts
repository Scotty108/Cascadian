import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function listViews() {
  console.log('=== Listing All Views in polymarket Database ===\n');

  const query = `
    SELECT name, engine
    FROM system.tables
    WHERE database = 'polymarket'
      AND engine LIKE '%View%'
    ORDER BY name
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const views = await result.json<{ name: string; engine: string }[]>();

  console.log(`Found ${views.length} views:\n`);
  views.forEach((v) => console.log(`  - ${v.name} (${v.engine})`));

  console.log('\n=== Views containing "trade" or "canonical" ===\n');
  const filtered = views.filter(v =>
    v.name.toLowerCase().includes('trade') ||
    v.name.toLowerCase().includes('canonical')
  );

  filtered.forEach((v) => console.log(`  - ${v.name}`));

  if (filtered.length === 0) {
    console.log('  (none found)');
  }

  process.exit(0);
}

listViews().catch(console.error);
