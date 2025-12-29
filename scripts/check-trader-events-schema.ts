import { clickhouse } from '../lib/clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  const result = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_trader_events_v2',
    format: 'JSONEachRow'
  });
  
  const schema = await result.json();
  console.log('pm_trader_events_v2 schema:');
  console.log(schema);
  
  console.log('\nSample rows:');
  const sampleResult = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_trader_events_v2
      WHERE trader_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
      LIMIT 3
    `,
    format: 'JSONEachRow'
  });
  
  const samples = await sampleResult.json();
  console.log(JSON.stringify(samples, null, 2));
}

main().catch(console.error);
