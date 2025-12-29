import { clickhouse } from '../lib/clickhouse/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const EGG = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('Searching for March $6 markets...\n');
  
  const query = `
    SELECT DISTINCT
        m.condition_id,
        m.question,
        count(*) as egg_trades
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '${EGG}'
      AND lower(m.question) LIKE '%march%'
      AND (lower(m.question) LIKE '%6%' OR lower(m.question) LIKE '%six%')
    GROUP BY m.condition_id, m.question
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const markets: any[] = await result.json();

  console.log(`Found ${markets.length} markets:`);
  markets.forEach(m => {
    console.log(`  - ${m.question}`);
    console.log(`    Condition: ${m.condition_id}`);
    console.log(`    Trades: ${m.egg_trades}`);
  });
}

main().catch(console.error);
