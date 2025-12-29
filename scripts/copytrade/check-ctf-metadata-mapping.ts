/**
 * Check if CTF condition_ids can be mapped via metadata
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  // Get all condition_ids from this wallet's CTF events
  const ctfEvents = (await clickhouse.query({
    query: `
      SELECT
        condition_id,
        event_type,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_usdc,
        min(event_timestamp) as first_event,
        max(event_timestamp) as last_event,
        count() as event_count
      FROM pm_ctf_events
      WHERE lower(user_address) = '${WALLET}'
        AND condition_id != ''
      GROUP BY condition_id, event_type
      ORDER BY last_event DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  }).then(r => r.json())) as any[];

  console.log('=== CTF Events by Condition ID ===');
  console.log('condition_id | type | usdc | events | last_event');
  ctfEvents.forEach(e => {
    console.log(
      e.condition_id.slice(0, 16) + '... | ' +
      e.event_type + ' | $' +
      Number(e.total_usdc).toFixed(2) + ' | ' +
      e.event_count + ' | ' +
      e.last_event
    );
  });

  // Get unique condition_ids
  const uniqueConditions = [...new Set(ctfEvents.map(e => e.condition_id))];
  console.log('\nUnique conditions:', uniqueConditions.length);

  // Check if these condition_ids are in pm_market_metadata
  const condIdsStr = uniqueConditions.map(c => `'${c}'`).join(',');

  const metadata = (await clickhouse.query({
    query: `
      SELECT condition_id, question, token_ids
      FROM pm_market_metadata FINAL
      WHERE condition_id IN (${condIdsStr})
      LIMIT 30
    `,
    format: 'JSONEachRow'
  }).then(r => r.json())) as any[];

  console.log('\n=== Matching Markets in Metadata ===');
  console.log('Found:', metadata.length, 'markets');

  metadata.slice(0, 5).forEach(m => {
    console.log(m.question?.slice(0, 60) + '...');
    const tokenIdsStr = JSON.stringify(m.token_ids);
    console.log('  token_ids:', tokenIdsStr?.slice(0, 80) + (tokenIdsStr?.length > 80 ? '...' : ''));
  });

  // Check coverage
  const matchedConditions = new Set(metadata.map(m => m.condition_id));
  const unmatched = uniqueConditions.filter(c => !matchedConditions.has(c));

  console.log('\n=== Coverage ===');
  console.log('Unique conditions in CTF:', uniqueConditions.length);
  console.log('Found in metadata:', matchedConditions.size);
  console.log('Missing from metadata:', unmatched.length);

  if (unmatched.length > 0) {
    console.log('\nUnmatched condition_ids (first 5):');
    unmatched.slice(0, 5).forEach(c => console.log('  ' + c));
  }
}

main().catch(console.error);
