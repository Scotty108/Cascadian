import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000
});

const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';

async function main() {
  // Check vw_fills_normalized schema
  console.log('=== vw_fills_normalized SCHEMA ===');
  const fillsSchemaRes = await clickhouse.query({
    query: 'DESCRIBE TABLE vw_fills_normalized',
    format: 'JSONEachRow'
  });
  const fillsSchema = await fillsSchemaRes.json() as any[];
  for (const col of fillsSchema) {
    console.log('  ' + col.name + ': ' + col.type);
  }
  
  // Sample vw_fills_normalized
  console.log('\n=== vw_fills_normalized - SAMPLE ===');
  const fillsSampleRes = await clickhouse.query({
    query: `SELECT * FROM vw_fills_normalized WHERE maker = '${THEO}' OR taker = '${THEO}' LIMIT 5`,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 30 }
  });
  const fillsSample = await fillsSampleRes.json();
  console.log(JSON.stringify(fillsSample, null, 2));
  
  // Check pm_trader_events_v2 schema
  console.log('\n=== pm_trader_events_v2 SCHEMA ===');
  const eventsSchemaRes = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_trader_events_v2',
    format: 'JSONEachRow'
  });
  const eventsSchema = await eventsSchemaRes.json() as any[];
  for (const col of eventsSchema) {
    console.log('  ' + col.name + ': ' + col.type);
  }
  
  // Sample pm_trader_events_v2 for Theo
  console.log('\n=== pm_trader_events_v2 - THEO SAMPLE ===');
  const eventsSampleRes = await clickhouse.query({
    query: `SELECT * FROM pm_trader_events_v2 WHERE wallet = '${THEO}' LIMIT 5`,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 30 }
  });
  const eventsSample = await eventsSampleRes.json();
  console.log(JSON.stringify(eventsSample, null, 2));
  
  // Check vw_pm_ledger schema
  console.log('\n=== vw_pm_ledger SCHEMA ===');
  const ledgerSchemaRes = await clickhouse.query({
    query: 'DESCRIBE TABLE vw_pm_ledger',
    format: 'JSONEachRow'
  });
  const ledgerSchema = await ledgerSchemaRes.json() as any[];
  for (const col of ledgerSchema) {
    console.log('  ' + col.name + ': ' + col.type);
  }
  
  await clickhouse.close();
}

main().catch(console.error);
