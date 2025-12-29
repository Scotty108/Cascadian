import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Checking Dedupe Identity Columns ===\n');

  // Full schema
  const schemaQuery = await clickhouse.query({
    query: 'DESCRIBE pm_unified_ledger_v9_clob_tbl',
    format: 'JSONEachRow'
  });
  const schema = await schemaQuery.json() as any[];
  console.log('pm_unified_ledger_v9_clob_tbl columns:');
  schema.forEach((c: any) => console.log('   ' + c.name + ': ' + c.type));

  // Test GPT's suggested identity: (tx_hash, log_index) or event_id
  console.log('\n=== Testing Identity Column Candidates ===');
  
  // Does event_id work as identity?
  const eventIdTest = await clickhouse.query({
    query: `SELECT 
              count() as total_rows,
              countDistinct(event_id) as unique_events,
              countDistinct(concat(event_id, '_', toString(outcome_index))) as event_outcome_combos
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'`,
    format: 'JSONEachRow'
  });
  const evTest = (await eventIdTest.json() as any[])[0];
  console.log('event_id as identity:');
  console.log('   Total rows: ' + evTest.total_rows);
  console.log('   Unique event_ids: ' + evTest.unique_events);
  console.log('   Unique (event_id, outcome_index): ' + evTest.event_outcome_combos);

  // Sample an event with dupes to see what differs
  console.log('\n=== Sample Duplicate Event ===');
  const dupeQuery = await clickhouse.query({
    query: `SELECT event_id, count() as cnt
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'
            GROUP BY event_id
            HAVING cnt > 1
            LIMIT 1`,
    format: 'JSONEachRow'
  });
  const dupeSample = await dupeQuery.json() as any[];
  
  if (dupeSample.length > 0) {
    const eventId = dupeSample[0].event_id;
    console.log('Event: ' + eventId.slice(0, 40) + '...');
    
    const detailQuery = await clickhouse.query({
      query: `SELECT *
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE event_id = '${eventId}'
                AND lower(wallet_address) = lower('${wallet}')`,
      format: 'JSONEachRow'
    });
    const details = await detailQuery.json() as any[];
    console.log('Has ' + details.length + ' rows:');
    details.forEach((d: any, i: number) => {
      console.log('   Row ' + (i+1) + ':');
      Object.keys(d).forEach(k => console.log('      ' + k + ': ' + d[k]));
    });
  }
}

main().catch(console.error);
