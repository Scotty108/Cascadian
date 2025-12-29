import { getClickHouseClient } from '../../lib/clickhouse/client';

const wallet = process.argv[2] || '0x743510ee9f21e24071c4e28edab4653df44ea620';

async function investigate() {
  const client = getClickHouseClient();

  console.log(`\n=== Investigating: ${wallet} ===\n`);

  // Check what Dome says
  console.log('=== Dome Benchmark ===');
  const dome = await client.query({
    query: `SELECT wallet, pnl_value, benchmark_set, source FROM pm_ui_pnl_benchmarks_v1 WHERE wallet = '${wallet}' LIMIT 1`,
    format: 'JSONEachRow'
  });
  const domeRows = await dome.json();
  console.log(JSON.stringify(domeRows, null, 2));

  // Check CLOB events
  console.log('\n=== CLOB Events Summary (deduplicated) ===');
  const events = await client.query({
    query: `
      SELECT 
        side,
        count() as cnt,
        round(sum(usdc)/1e6, 2) as total_usdc,
        round(sum(tokens)/1e6, 2) as total_tokens
      FROM (
        SELECT 
          event_id,
          any(side) as side,
          any(usdc_amount) as usdc,
          any(token_amount) as tokens
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}'
          AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY side
    `,
    format: 'JSONEachRow'
  });
  const eventRows = await events.json();
  console.log(JSON.stringify(eventRows, null, 2));

  // Check transfers
  console.log('\n=== ERC1155 Transfers ===');
  const transfers = await client.query({
    query: `
      SELECT 
        transfer_type,
        count() as cnt,
        round(sum(abs(amount))/1e6, 2) as total_amount
      FROM erc1155_transfers
      WHERE from_address = '${wallet}' OR to_address = '${wallet}'
      GROUP BY transfer_type
    `,
    format: 'JSONEachRow'
  });
  const transferRows = await transfers.json();
  console.log(JSON.stringify(transferRows, null, 2));

  // Check resolutions for this wallet's positions
  console.log('\n=== Market Resolutions ===');
  const resolutions = await client.query({
    query: `
      SELECT 
        countDistinct(condition_id) as total_conditions,
        countIf(winning_outcome >= 0) as resolved_conditions,
        countIf(winning_outcome < 0) as unresolved_conditions
      FROM (
        SELECT DISTINCT condition_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${wallet}' AND is_deleted = 0
      ) t
      LEFT JOIN pm_condition_resolutions r USING (condition_id)
    `,
    format: 'JSONEachRow'
  });
  const resRows = await resolutions.json();
  console.log(JSON.stringify(resRows, null, 2));
}

investigate().catch(console.error);
