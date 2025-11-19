#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function main() {
  console.log('=== INVESTIGATING 0% COVERAGE ===\n');

  // Sample from trades
  console.log('Sample condition_ids from vw_trades_canonical:');
  const tradesResult = await client.query({
    query: `SELECT DISTINCT condition_id_norm FROM vw_trades_canonical WHERE condition_id_norm != '' LIMIT 5`,
    format: 'JSONEachRow'
  });
  const trades = await tradesResult.json();
  console.log(trades);
  
  // Sample from resolutions
  console.log('\nSample condition_ids from market_resolutions_final:');
  const resResult = await client.query({
    query: `SELECT DISTINCT condition_id_norm FROM market_resolutions_final WHERE condition_id_norm != '' LIMIT 5`,
    format: 'JSONEachRow'
  });
  const resolutions = await resResult.json();
  console.log(resolutions);
  
  // Check data types
  console.log('\nvw_trades_canonical.condition_id_norm type:');
  const tradeType = await client.query({
    query: `SELECT type FROM system.columns WHERE database = 'default' AND table = 'vw_trades_canonical' AND name = 'condition_id_norm'`,
    format: 'JSONEachRow'
  });
  console.log(await tradeType.json());
  
  console.log('\nmarket_resolutions_final.condition_id_norm type:');
  const resType = await client.query({
    query: `SELECT type FROM system.columns WHERE database = 'default' AND table = 'market_resolutions_final' AND name = 'condition_id_norm'`,
    format: 'JSONEachRow'
  });
  console.log(await resType.json());
  
  // Try to find ANY match
  console.log('\nAttempting direct match on one condition_id:');
  const testCid = trades[0].condition_id_norm;
  const matchResult = await client.query({
    query: `
      SELECT * 
      FROM market_resolutions_final 
      WHERE condition_id_norm = '${testCid}'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const match = await matchResult.json();
  console.log(`Looking for: ${testCid}`);
  console.log('Found:', match.length > 0 ? 'YES' : 'NO');
  if (match.length > 0) console.log(match[0]);
  
  // Try CAST to see if type mismatch is the issue
  console.log('\nTrying with CAST:');
  const castResult = await client.query({
    query: `
      SELECT COUNT(*) as cnt
      FROM vw_trades_canonical t
      INNER JOIN market_resolutions_final r 
        ON CAST(t.condition_id_norm AS String) = CAST(r.condition_id_norm AS String)
      WHERE t.condition_id_norm != ''
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  console.log(await castResult.json());
  
  await client.close();
}

main().catch(console.error);
