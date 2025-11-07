#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function checkSpecificConditions() {
  console.log('='.repeat(80));
  console.log('CHECKING SPECIFIC CONDITIONS FROM FAILING WALLETS');
  console.log('='.repeat(80));
  console.log();

  // Conditions from Wallet 3's top trades
  const wallet3Conditions = [
    'db44b463f55d035e5c3ec5090ac1c0cd9a360e29717bfd14daed56bcc8478006',
    'b405244a4d3f342769da666ab9b831c5b365c96496c62f4a986319fb24bba2aa',
    'fcb61a7e6160c0ab312a672cf9a953e7db86631c8880d208c0c4657b484e7bbc'
  ];

  console.log('📋 Checking conditions from Wallet 3...\n');

  for (const conditionId of wallet3Conditions) {
    console.log(`\nCondition: ${conditionId.slice(0, 16)}...`);

    const query = `
      SELECT *
      FROM market_resolutions_final
      WHERE condition_id_norm = '${conditionId}'
    `;

    const result = await client.query({ query, format: 'JSONEachRow' });
    const data: any[] = await result.json();

    if (data.length > 0) {
      console.log('✅ Found in market_resolutions_final:');
      console.log(data[0]);
    } else {
      console.log('❌ NOT FOUND in market_resolutions_final');
    }
  }

  // Now check the JOIN between trades_raw and market_resolutions_final
  console.log('\n' + '='.repeat(80));
  console.log('TESTING JOIN FOR WALLET 3');
  console.log('='.repeat(80));
  console.log();

  const joinQuery = `
    SELECT
      t.wallet_address,
      t.condition_id as trade_condition_id,
      lower(replaceAll(t.condition_id, '0x', '')) as normalized_condition_id,
      r.condition_id_norm,
      r.winning_outcome,
      r.resolved_at,
      CASE WHEN r.condition_id_norm IS NOT NULL THEN 'JOINED' ELSE 'NOT_JOINED' END as join_status
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r
      ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE lower(t.wallet_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
      AND t.condition_id != ''
    LIMIT 20
  `;

  const joinResult = await client.query({ query: joinQuery, format: 'JSONEachRow' });
  const joinData: any[] = await joinResult.json();

  console.log('Sample JOIN results:');
  console.table(joinData);

  // Count join success rate
  const joinStatsQuery = `
    SELECT
      countIf(r.condition_id_norm IS NOT NULL) as joined_count,
      countIf(r.condition_id_norm IS NULL) as not_joined_count,
      count() as total,
      (joined_count * 100.0 / total) as join_rate
    FROM trades_raw t
    LEFT JOIN market_resolutions_final r
      ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
    WHERE lower(t.wallet_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
      AND t.condition_id != ''
  `;

  const statsResult = await client.query({ query: joinStatsQuery, format: 'JSONEachRow' });
  const stats: any = (await statsResult.json())[0];

  console.log('\n📊 JOIN Statistics for Wallet 3:');
  console.table(stats);

  await client.close();
}

checkSpecificConditions()
  .then(() => {
    console.log('\n✅ Complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Error:', err);
    process.exit(1);
  });
