import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xd34d2111bbc4c579e3e4dbec7bc550d369dacdb4';

async function main() {
  console.log('=== Checking for Data Triplication ===\n');

  // Check distribution of row counts per event_id
  const distQuery = await clickhouse.query({
    query: `SELECT 
              count_per_event,
              count() as num_events,
              sum(count_per_event) as total_rows
            FROM (
              SELECT event_id, count() as count_per_event
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE lower(wallet_address) = lower('${wallet}')
                AND source_type = 'CLOB'
              GROUP BY event_id
            )
            GROUP BY count_per_event
            ORDER BY count_per_event`,
    format: 'JSONEachRow'
  });
  const dist = await distQuery.json() as any[];
  
  console.log('Row count distribution per event_id:');
  console.log('Rows/Event | # Events | Total Rows');
  console.log('-----------|----------|----------');
  dist.forEach((d: any) => {
    console.log(String(d.count_per_event).padStart(10) + ' | ' + 
                String(d.num_events).padStart(8) + ' | ' + 
                String(d.total_rows).padStart(10));
  });

  // Sample a tripled event
  const sampleQuery = await clickhouse.query({
    query: `SELECT event_id
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'
            GROUP BY event_id
            HAVING count() = 3
            LIMIT 1`,
    format: 'JSONEachRow'
  });
  const sample = await sampleQuery.json() as any[];
  
  if (sample.length > 0) {
    const eventId = sample[0].event_id;
    console.log('\n=== Sample Tripled Event ===');
    console.log('Event ID:', eventId.slice(0, 50) + '...');
    
    const detailQuery = await clickhouse.query({
      query: `SELECT 
                event_id,
                condition_id,
                outcome_index,
                usdc_delta,
                token_delta,
                role,
                side,
                event_time
              FROM pm_unified_ledger_v9_clob_tbl
              WHERE event_id = '${eventId}'
                AND lower(wallet_address) = lower('${wallet}')`,
      format: 'JSONEachRow'
    });
    const details = await detailQuery.json() as any[];
    
    console.log('\nAll 3 rows for this event:');
    details.forEach((d: any, i: number) => {
      console.log((i+1) + '. usdc=' + d.usdc_delta + ', tok=' + d.token_delta + 
                  ', role=' + d.role + ', side=' + d.side + ', time=' + d.event_time);
    });
  }

  // Check if tripled rows are identical
  console.log('\n=== Are tripled rows identical? ===');
  const identicalQuery = await clickhouse.query({
    query: `SELECT 
              event_id,
              countDistinct(concat(toString(usdc_delta), '_', toString(token_delta), '_', role, '_', side)) as unique_combos,
              count() as row_count
            FROM pm_unified_ledger_v9_clob_tbl
            WHERE lower(wallet_address) = lower('${wallet}')
              AND source_type = 'CLOB'
            GROUP BY event_id
            HAVING row_count > 1
            ORDER BY row_count DESC
            LIMIT 10`,
    format: 'JSONEachRow'
  });
  const identical = await identicalQuery.json() as any[];
  
  console.log('Event ID                      | Rows | Unique Combos');
  console.log('------------------------------|------|-------------');
  identical.forEach((i: any) => {
    const isIdentical = i.unique_combos === 1;
    console.log(i.event_id.slice(0, 30) + ' | ' + 
                String(i.row_count).padStart(4) + ' | ' + 
                String(i.unique_combos).padStart(13) + 
                (isIdentical ? ' ← IDENTICAL!' : ''));
  });
}

main().catch(console.error);
