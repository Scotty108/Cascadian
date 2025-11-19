#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Checking external_trades_raw for resolution hints:\n');

  const ghostConditions = [
    'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
    'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
    '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
    'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44'
  ];

  for (const cid of ghostConditions) {
    const query = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          market_question,
          outcome_index,
          side,
          price,
          trade_timestamp
        FROM external_trades_raw
        WHERE condition_id = '${cid}'
        ORDER BY trade_timestamp DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const result = await query.json<any>();

    if (result.length === 0) {
      console.log(`${cid.substring(0,16)}... - NO TRADES FOUND`);
      continue;
    }

    console.log(`${cid.substring(0,16)}... - ${result[0]?.market_question?.substring(0,50)}...`);
    console.log(`  Total trades: ${result.length >= 5 ? '5+' : result.length}`);
    console.log(`  Last 3 trades:`);

    for (const row of result.slice(0, 3)) {
      console.log(`    ${row.side} outcome ${row.outcome_index} @ $${row.price.toFixed(4)} on ${row.trade_timestamp}`);
    }

    // Analyze price patterns
    const lastPrice = parseFloat(result[0].price);
    const lastOutcome = result[0].outcome_index;

    if (lastPrice < 0.1) {
      console.log(`  💡 Last price < $0.10 suggests outcome ${lastOutcome} LOST (other side won)`);
    } else if (lastPrice > 0.9) {
      console.log(`  💡 Last price > $0.90 suggests outcome ${lastOutcome} WON`);
    } else {
      console.log(`  ⚠️  Last price $${lastPrice} inconclusive`);
    }

    console.log('');
  }
}

main().catch(console.error);
