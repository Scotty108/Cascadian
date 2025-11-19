import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkOutcomePositionsSchema() {
  console.log('=== Checking outcome_positions_v3 Schema ===\n');

  // Get schema
  const schemaQuery = `DESCRIBE outcome_positions_v3`;
  const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
  const schema = await schemaResult.json<any[]>();

  console.log('Schema of outcome_positions_v3:');
  schema.forEach(col => {
    console.log(`  ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log('');

  // Get sample data for xcnstrategy
  console.log('Sample data for xcnstrategy:\n');

  const sampleQuery = `
    SELECT *
    FROM outcome_positions_v3
    WHERE lower(wallet_address) = lower('${EOA}')
    LIMIT 3
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json<any[]>();

  if (samples.length > 0) {
    console.log(JSON.stringify(samples, null, 2));
  } else {
    console.log('No data found for this wallet.');
  }
  console.log('');

  // Count total rows
  const countQuery = `
    SELECT count() AS total
    FROM outcome_positions_v3
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = await countResult.json<any[]>();

  console.log(`Total positions for this wallet: ${countData[0].total}`);
}

checkOutcomePositionsSchema().catch(console.error);
