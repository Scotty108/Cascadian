import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function checkSchemas() {
  console.log('Checking table schemas...\n');
  
  // Check realized_pnl_by_market_final
  console.log('1. realized_pnl_by_market_final schema:');
  const schema1 = await clickhouse.query({
    query: `DESCRIBE TABLE realized_pnl_by_market_final`,
    format: 'JSONEachRow',
  });
  const cols1 = await schema1.json();
  console.log(JSON.stringify(cols1.map((c: any) => c.name), null, 2));
  console.log();
  
  // Check wallet_metrics
  console.log('2. wallet_metrics schema:');
  const schema2 = await clickhouse.query({
    query: `DESCRIBE TABLE wallet_metrics`,
    format: 'JSONEachRow',
  });
  const cols2 = await schema2.json();
  console.log(JSON.stringify(cols2.map((c: any) => c.name), null, 2));
  console.log();
  
  // Check outcome_positions_v2
  console.log('3. outcome_positions_v2 schema:');
  const schema3 = await clickhouse.query({
    query: `DESCRIBE TABLE outcome_positions_v2`,
    format: 'JSONEachRow',
  });
  const cols3 = await schema3.json();
  console.log(JSON.stringify(cols3.map((c: any) => c.name), null, 2));
}

checkSchemas().catch(console.error);
