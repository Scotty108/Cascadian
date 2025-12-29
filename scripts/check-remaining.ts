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
  // Sample pm_trader_events_v2 for Theo using correct column
  console.log('=== pm_trader_events_v2 - THEO SAMPLE ===');
  const eventsSampleRes = await clickhouse.query({
    query: `SELECT * FROM pm_trader_events_v2 WHERE trader_wallet = '${THEO}' LIMIT 5`,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 60 }
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
  
  // Sample vw_pm_ledger
  console.log('\n=== vw_pm_ledger - SAMPLE ===');
  const ledgerSampleRes = await clickhouse.query({
    query: 'SELECT * FROM vw_pm_ledger LIMIT 3',
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 60 }
  });
  const ledgerSample = await ledgerSampleRes.json();
  console.log(JSON.stringify(ledgerSample, null, 2));
  
  // Check vw_trades_enriched
  console.log('\n=== vw_trades_enriched SCHEMA ===');
  const tradesSchemaRes = await clickhouse.query({
    query: 'DESCRIBE TABLE vw_trades_enriched',
    format: 'JSONEachRow'
  });
  const tradesSchema = await tradesSchemaRes.json() as any[];
  for (const col of tradesSchema) {
    console.log('  ' + col.name + ': ' + col.type);
  }
  
  // Sample vw_trades_enriched
  console.log('\n=== vw_trades_enriched - SAMPLE ===');
  const tradesSampleRes = await clickhouse.query({
    query: 'SELECT * FROM vw_trades_enriched LIMIT 3',
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 60 }
  });
  const tradesSample = await tradesSampleRes.json();
  console.log(JSON.stringify(tradesSample, null, 2));
  
  await clickhouse.close();
}

main().catch(console.error);
