#!/usr/bin/env tsx
/**
 * Check schemas to understand the edge case data
 */

import * as dotenv from 'dotenv';
import { createClient } from '@clickhouse/client';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000
});

async function checkSchemas() {
  // 1. Check pm_condition_resolutions schema
  console.log('━━━ pm_condition_resolutions SCHEMA ━━━\n');
  const resSchema = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_condition_resolutions',
    format: 'JSONEachRow'
  });
  const resSchemaData = await resSchema.json<any[]>();
  console.table(resSchemaData);

  // Sample data
  console.log('\n━━━ pm_condition_resolutions SAMPLE ━━━\n');
  const resSample = await clickhouse.query({
    query: 'SELECT * FROM pm_condition_resolutions LIMIT 5',
    format: 'JSONEachRow'
  });
  const resSampleData = await resSample.json<any[]>();
  console.table(resSampleData);

  // 2. Check pm_trader_events_v2 schema (especially fee column)
  console.log('\n━━━ pm_trader_events_v2 SCHEMA ━━━\n');
  const eventsSchema = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_trader_events_v2',
    format: 'JSONEachRow'
  });
  const eventsSchemaData = await eventsSchema.json<any[]>();
  console.table(eventsSchemaData);

  // 3. Check if negative positions query works at all
  console.log('\n━━━ TESTING NEGATIVE POSITIONS QUERY ━━━\n');
  const simpleNegQuery = `
    SELECT
        t.trader_wallet,
        t.token_id,
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN t.side = 'BUY' THEN t.token_amount ELSE -t.token_amount END) as final_shares
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    GROUP BY t.trader_wallet, t.token_id, m.condition_id, m.outcome_index
    HAVING final_shares < -0.01
    LIMIT 10
  `;

  const negTest = await clickhouse.query({
    query: simpleNegQuery,
    format: 'JSONEachRow'
  });
  const negTestData = await negTest.json<any[]>();
  console.log(`Found ${negTestData.length} negative positions (limited to 10)`);
  console.table(negTestData.map(row => ({
    wallet: row.trader_wallet.substring(0, 10) + '...',
    token_id: row.token_id,
    condition_id: row.condition_id.substring(0, 16) + '...',
    outcome: row.outcome_index,
    shares: parseFloat(row.final_shares).toFixed(6)
  })));
}

checkSchemas()
  .then(() => {
    console.log('\n✅ Schema check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Schema check failed:', error);
    process.exit(1);
  });
