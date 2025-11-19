import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('Analyzing critical JOIN patterns...\n');

  const results = [];

  // JOIN 1: clob_fills -> gamma_markets (condition_id)
  console.log('JOIN 1: clob_fills -> gamma_markets (condition_id)');
  console.log('-'.repeat(60));

  const j1SampleQuery = await clickhouse.query({
    query: `SELECT condition_id FROM clob_fills LIMIT 5`,
    format: 'JSONEachRow'
  });
  const j1Samples = await j1SampleQuery.json();
  
  const j1FailQuery = await clickhouse.query({
    query: `
      SELECT count() as failed_joins
      FROM clob_fills cf
      LEFT JOIN gamma_markets gm ON cf.condition_id = gm.condition_id
      WHERE gm.condition_id IS NULL
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j1Fail = await j1FailQuery.json();

  const j1SuccessQuery = await clickhouse.query({
    query: `
      SELECT count() as successful_joins
      FROM clob_fills cf
      INNER JOIN gamma_markets gm ON lower(replaceAll(cf.condition_id, '0x', '')) = gm.condition_id
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j1Success = await j1SuccessQuery.json();

  console.log(`  clob_fills samples:`, j1Samples.map(s => s.condition_id).slice(0,3));
  console.log(`  Direct JOIN failures: ${j1Fail[0].failed_joins}`);
  console.log(`  Normalized JOIN successes: ${j1Success[0].successful_joins}\n`);

  results.push({
    join_name: 'clob_fills -> gamma_markets',
    left_table: 'clob_fills',
    right_table: 'gamma_markets',
    join_column: 'condition_id',
    left_samples: j1Samples.map(s => s.condition_id).slice(0,3),
    direct_failures: j1Fail[0].failed_joins,
    normalized_successes: j1Success[0].successful_joins
  });

  // JOIN 2: clob_fills -> market_key_map (condition_id)
  console.log('JOIN 2: clob_fills -> market_key_map (condition_id)');
  console.log('-'.repeat(60));

  const j2SampleQuery = await clickhouse.query({
    query: `SELECT condition_id FROM market_key_map LIMIT 5`,
    format: 'JSONEachRow'
  });
  const j2Samples = await j2SampleQuery.json();

  const j2FailQuery = await clickhouse.query({
    query: `
      SELECT count() as failed_joins
      FROM clob_fills cf
      LEFT JOIN market_key_map mkm ON cf.condition_id = mkm.condition_id
      WHERE mkm.condition_id IS NULL
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j2Fail = await j2FailQuery.json();

  const j2SuccessQuery = await clickhouse.query({
    query: `
      SELECT count() as successful_joins
      FROM clob_fills cf
      INNER JOIN market_key_map mkm ON lower(replaceAll(cf.condition_id, '0x', '')) = mkm.condition_id
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j2Success = await j2SuccessQuery.json();

  console.log(`  market_key_map samples:`, j2Samples.map(s => s.condition_id).slice(0,3));
  console.log(`  Direct JOIN failures: ${j2Fail[0].failed_joins}`);
  console.log(`  Normalized JOIN successes: ${j2Success[0].successful_joins}\n`);

  results.push({
    join_name: 'clob_fills -> market_key_map',
    left_table: 'clob_fills',
    right_table: 'market_key_map',
    join_column: 'condition_id',
    right_samples: j2Samples.map(s => s.condition_id).slice(0,3),
    direct_failures: j2Fail[0].failed_joins,
    normalized_successes: j2Success[0].successful_joins
  });

  // JOIN 3: gamma_markets -> market_resolutions_final (condition_id)
  console.log('JOIN 3: gamma_markets -> market_resolutions_final (condition_id)');
  console.log('-'.repeat(60));

  const j3SampleLeftQuery = await clickhouse.query({
    query: `SELECT condition_id FROM gamma_markets LIMIT 5`,
    format: 'JSONEachRow'
  });
  const j3SamplesLeft = await j3SampleLeftQuery.json();

  const j3SampleRightQuery = await clickhouse.query({
    query: `SELECT condition_id_norm FROM market_resolutions_final LIMIT 5`,
    format: 'JSONEachRow'
  });
  const j3SamplesRight = await j3SampleRightQuery.json();

  const j3FailQuery = await clickhouse.query({
    query: `
      SELECT count() as failed_joins
      FROM gamma_markets gm
      LEFT JOIN market_resolutions_final mrf ON gm.condition_id = mrf.condition_id_norm
      WHERE mrf.condition_id_norm IS NULL
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j3Fail = await j3FailQuery.json();

  const j3SuccessQuery = await clickhouse.query({
    query: `
      SELECT count() as successful_joins
      FROM gamma_markets gm
      INNER JOIN market_resolutions_final mrf ON gm.condition_id = mrf.condition_id_norm
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j3Success = await j3SuccessQuery.json();

  console.log(`  gamma_markets samples:`, j3SamplesLeft.map(s => s.condition_id).slice(0,2));
  console.log(`  market_resolutions_final samples:`, j3SamplesRight.map(s => s.condition_id_norm).slice(0,2));
  console.log(`  Direct JOIN failures: ${j3Fail[0].failed_joins}`);
  console.log(`  Direct JOIN successes: ${j3Success[0].successful_joins}\n`);

  results.push({
    join_name: 'gamma_markets -> market_resolutions_final',
    left_table: 'gamma_markets',
    right_table: 'market_resolutions_final',
    join_column: 'condition_id / condition_id_norm',
    left_samples: j3SamplesLeft.map(s => s.condition_id).slice(0,2),
    right_samples: j3SamplesRight.map(s => s.condition_id_norm).slice(0,2),
    direct_failures: j3Fail[0].failed_joins,
    direct_successes: j3Success[0].successful_joins
  });

  // JOIN 4: erc1155_transfers -> gamma_markets (token_id)
  console.log('JOIN 4: erc1155_transfers -> gamma_markets (token_id)');
  console.log('-'.repeat(60));

  const j4SampleLeftQuery = await clickhouse.query({
    query: `SELECT token_id FROM erc1155_transfers LIMIT 5`,
    format: 'JSONEachRow'
  });
  const j4SamplesLeft = await j4SampleLeftQuery.json();

  const j4SampleRightQuery = await clickhouse.query({
    query: `SELECT token_id FROM gamma_markets LIMIT 5`,
    format: 'JSONEachRow'
  });
  const j4SamplesRight = await j4SampleRightQuery.json();

  const j4FailQuery = await clickhouse.query({
    query: `
      SELECT count() as failed_joins
      FROM erc1155_transfers et
      LEFT JOIN gamma_markets gm ON et.token_id = gm.token_id
      WHERE gm.token_id IS NULL
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j4Fail = await j4FailQuery.json();

  const j4SuccessQuery = await clickhouse.query({
    query: `
      SELECT count() as successful_joins
      FROM erc1155_transfers et
      INNER JOIN gamma_markets gm ON et.token_id = gm.token_id
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const j4Success = await j4SuccessQuery.json();

  console.log(`  erc1155_transfers samples:`, j4SamplesLeft.map(s => s.token_id).slice(0,2));
  console.log(`  gamma_markets samples:`, j4SamplesRight.map(s => s.token_id).slice(0,2));
  console.log(`  Direct JOIN failures: ${j4Fail[0].failed_joins}`);
  console.log(`  Direct JOIN successes: ${j4Success[0].successful_joins}\n`);

  results.push({
    join_name: 'erc1155_transfers -> gamma_markets',
    left_table: 'erc1155_transfers',
    right_table: 'gamma_markets',
    join_column: 'token_id',
    left_samples: j4SamplesLeft.map(s => s.token_id).slice(0,2),
    right_samples: j4SamplesRight.map(s => s.token_id).slice(0,2),
    direct_failures: j4Fail[0].failed_joins,
    direct_successes: j4Success[0].successful_joins
  });

  writeFileSync('./JOIN_FAILURE_ANALYSIS.json', JSON.stringify({ analyzed_at: new Date().toISOString(), results }, null, 2));
  console.log('Results saved to JOIN_FAILURE_ANALYSIS.json');
}

main().catch(console.error);
