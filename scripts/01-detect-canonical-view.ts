import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkViews() {
  console.log('=== Step 1: Detecting Canonical Trades View ===\n');

  // Check which views exist (check both views and tables)
  const viewsQuery = `
    SELECT name, engine
    FROM system.tables
    WHERE database = currentDatabase()
      AND (
        name LIKE '%trades_canonical%'
        OR name LIKE '%canonical%trade%'
        OR name LIKE '%trade%canonical%'
      )
    ORDER BY name
  `;

  const views = await clickhouse.query({ query: viewsQuery, format: 'JSONEachRow' });
  const viewsList = await views.json<{ name: string; engine: string }[]>();

  console.log('Available canonical trades views/tables:');
  viewsList.forEach((v) => console.log(`  - ${v.name} (${v.engine})`));
  console.log('');

  // Check for preferred views (try multiple naming patterns)
  const candidates = [
    'vw_trades_canonical_current',
    'vw_trades_canonical_v3_preview',
    'vw_canonical_trades_v3_preview',
    'vw_canonical_trades_current',
    'trades_canonical_current',
    'trades_canonical_v3_preview',
    'trades_canonical_v3',
    'canonical_trades_v3',
    'canonical_trades',
  ];

  let chosenView = '';
  for (const candidate of candidates) {
    if (viewsList.some((v) => v.name === candidate)) {
      chosenView = candidate;
      console.log(`✓ Found ${candidate}`);
      break;
    }
  }

  if (!chosenView && viewsList.length > 0) {
    // If we found some canonical trades tables but none match our preferred names,
    // use the first one that looks like it contains v3
    const v3Table = viewsList.find(v => v.name.toLowerCase().includes('v3'));
    if (v3Table) {
      chosenView = v3Table.name;
      console.log(`✓ Using ${chosenView} (found via pattern matching)`);
    } else {
      // Just use the first one
      chosenView = viewsList[0].name;
      console.log(`✓ Using ${chosenView} (first available canonical trades table)`);
    }
  }

  if (!chosenView) {
    console.log('✗ No canonical trades view/table found. Available:', viewsList.map((v) => v.name).join(', '));
    process.exit(1);
  }

  console.log('');
  console.log('CHOSEN VIEW:', chosenView);
  console.log('');

  // Quick schema check
  console.log('Checking view schema...');
  const schemaQuery = `DESCRIBE ${chosenView}`;
  const schema = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
  const schemaList = await schema.json<{ name: string; type: string }[]>();

  const hasConditionId = schemaList.some((col) => col.name === 'canonical_condition_id');
  const hasWalletAddress = schemaList.some((col) => col.name === 'wallet_address');
  const hasTimestamp = schemaList.some((col) => col.name === 'timestamp');

  console.log('Key fields present:');
  console.log('  - canonical_condition_id:', hasConditionId ? '✓' : '✗');
  console.log('  - wallet_address:', hasWalletAddress ? '✓' : '✗');
  console.log('  - timestamp:', hasTimestamp ? '✓' : '✗');
  console.log('');

  if (!hasConditionId || !hasWalletAddress || !hasTimestamp) {
    console.log('✗ View missing required fields');
    process.exit(1);
  }

  // Quick sample
  console.log('Sample row from chosen view:');
  const sampleQuery = `SELECT * FROM ${chosenView} LIMIT 1`;
  const sample = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sample.json<any[]>();
  console.log(JSON.stringify(sampleData[0], null, 2));

  console.log('\n✓ Step 1 Complete: Using', chosenView);
  process.exit(0);
}

checkViews().catch(console.error);
