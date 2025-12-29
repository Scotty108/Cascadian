import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const TABLES = [
  'pm_condition_resolutions',
  'pm_market_metadata',
  'pm_market_pnl',
  'pm_market_pnl_with_resolution',
  'pm_token_to_condition_map',
  'pm_token_to_condition_map_v2',
  'pm_trader_events'
];

async function main() {
  for (const tableName of TABLES) {
    console.log('\n' + '='.repeat(60));
    console.log('TABLE: ' + tableName);
    console.log('='.repeat(60));
    
    // Get schema
    const schemaResult = await clickhouse.query({
      query: 'DESCRIBE TABLE ' + tableName,
      format: 'JSONEachRow'
    });
    const schema = await schemaResult.json() as any[];
    
    console.log('\n--- SCHEMA ---');
    for (const col of schema) {
      console.log('  ' + col.name + ': ' + col.type + (col.default_expression ? ' [default: ' + col.default_expression + ']' : ''));
    }
  }
  
  await clickhouse.close();
}

main().catch(console.error);
