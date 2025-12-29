import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000
});

const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';
const SPORTS = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function describeAndSample(tableName: string, walletColumn?: string) {
  console.log('\n' + '='.repeat(70));
  console.log('TABLE: ' + tableName);
  console.log('='.repeat(70));
  
  try {
    // Count
    const countRes = await clickhouse.query({
      query: 'SELECT count() as cnt FROM ' + tableName,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 30 }
    });
    const countData = await countRes.json() as any[];
    console.log('Row count: ' + countData[0]?.cnt);
    
    // Schema
    const schemaRes = await clickhouse.query({
      query: 'DESCRIBE TABLE ' + tableName,
      format: 'JSONEachRow'
    });
    const schema = await schemaRes.json() as any[];
    console.log('\n--- SCHEMA ---');
    for (const col of schema) {
      console.log('  ' + col.name + ': ' + col.type);
    }
    
    // Sample 3 rows
    console.log('\n--- SAMPLE 3 ROWS ---');
    const sampleRes = await clickhouse.query({
      query: 'SELECT * FROM ' + tableName + ' LIMIT 3',
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 30 }
    });
    const sampleData = await sampleRes.json();
    console.log(JSON.stringify(sampleData, null, 2));
    
    // Check for target wallets if wallet column exists
    if (walletColumn) {
      console.log('\n--- THEO WALLET DATA ---');
      const theoRes = await clickhouse.query({
        query: `SELECT * FROM ${tableName} WHERE ${walletColumn} = '${THEO}' LIMIT 3`,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 30 }
      });
      const theoData = await theoRes.json() as any[];
      console.log('Found ' + theoData.length + ' rows for Theo');
      if (theoData.length > 0) console.log(JSON.stringify(theoData, null, 2));
      
      console.log('\n--- SPORTS BETTOR DATA ---');
      const sportsRes = await clickhouse.query({
        query: `SELECT * FROM ${tableName} WHERE ${walletColumn} = '${SPORTS}' LIMIT 3`,
        format: 'JSONEachRow',
        clickhouse_settings: { max_execution_time: 30 }
      });
      const sportsData = await sportsRes.json() as any[];
      console.log('Found ' + sportsData.length + ' rows for Sports Bettor');
      if (sportsData.length > 0) console.log(JSON.stringify(sportsData, null, 2));
    }
  } catch (e: any) {
    console.log('ERROR: ' + e.message);
  }
}

async function main() {
  // Key tables to investigate
  await describeAndSample('pm_ui_positions', 'wallet');
  await describeAndSample('pm_user_positions', 'wallet');
  await describeAndSample('pm_user_positions_clean', 'wallet');
  await describeAndSample('pm_wallet_condition_pnl_v4', 'wallet');
  await describeAndSample('pm_wallet_market_pnl_v4', 'wallet');
  await describeAndSample('pm_wallet_market_positions_raw', 'wallet');
  await describeAndSample('pm_wallet_pnl_PROVISIONAL', 'wallet');
  
  await clickhouse.close();
}

main().catch(console.error);
