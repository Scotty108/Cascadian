import { getClickHouseClient } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0xdbaed59f3c39b3aace4f3be5c7e8f96eb89f1aed';

async function debug() {
  const client = getClickHouseClient();

  console.log('=== Investigating:', wallet, '===\n');

  // Check if this wallet exists in trader events
  const events = await client.query({
    query: `
      SELECT
        count() as total_rows,
        countDistinct(event_id) as unique_events,
        countDistinct(condition_id) as unique_conditions,
        round(sum(usdc_amount)/1e6, 2) as total_usdc,
        round(sum(token_amount)/1e6, 2) as total_tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const eventsData = await events.json();
  console.log('CLOB Events:', JSON.stringify(eventsData, null, 2));

  // Check Dome benchmark
  const dome = await client.query({
    query: `SELECT wallet, pnl_value, benchmark_set, source FROM pm_ui_pnl_benchmarks_v1 WHERE wallet = '${wallet}'`,
    format: 'JSONEachRow'
  });
  const domeData = await dome.json();
  console.log('\nDome Benchmark:', JSON.stringify(domeData, null, 2));

  // Sample events
  const sample = await client.query({
    query: `
      SELECT
        event_id,
        side,
        round(usdc_amount/1e6, 4) as usdc,
        round(token_amount/1e6, 4) as tokens,
        condition_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
      ORDER BY trade_time
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const sampleData: any[] = await sample.json();
  console.log('\nSample Events (first 20):');
  sampleData.forEach((e) => {
    const condShort = e.condition_id ? e.condition_id.slice(0,16) + '...' : 'N/A';
    console.log(`  ${e.side} | USDC: ${e.usdc} | Tokens: ${e.tokens} | Condition: ${condShort}`);
  });

  // Check resolutions
  const res = await client.query({
    query: `
      SELECT
        countDistinct(te.condition_id) as total_conditions,
        countIf(r.winning_outcome IS NOT NULL) as resolved
      FROM (
        SELECT DISTINCT condition_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
      ) te
      LEFT JOIN pm_condition_resolutions r ON te.condition_id = r.condition_id
    `,
    format: 'JSONEachRow'
  });
  const resData = await res.json();
  console.log('\nResolution Status:', JSON.stringify(resData, null, 2));
}

debug().catch(console.error);
