/**
 * Investigate where V12 is getting positions that don't exist in CLOB
 *
 * The 4 positions showing negative V12 PnL but $0 API:
 * - Have NO CLOB trades
 * - Have NO resolution record
 * - Have NO API position
 *
 * So where is V12 finding them?
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xef9b7ff3f5ceedc4be6a0fa6fbb5f2c696899fef';

const MISMATCHED_CONDITIONS = [
  '263ab21500b1cb94e098b5fe14bd0f08eb64dfea2ff7aa5b82a88a3d36e8d618',
  '5872c8e6115ceb967f6e67c5a1ba5b00fe0d9bbb55b2e7f6edea01b87afc2a85',
  '68e505b808eb64da6c1e89d9cffcb99af1efc1cf403e2e69d2dbb4ec29f5e2cd',
  'a3e38b466dd2d4f04ddc2a59f2d1a28aa3bc3dcb71efd8e57bdc78614ca0fe71',
];

async function main() {
  console.log('='.repeat(80));
  console.log('SEARCHING FOR PHANTOM POSITIONS');
  console.log('='.repeat(80));

  for (const conditionId of MISMATCHED_CONDITIONS) {
    console.log('\n' + '-'.repeat(80));
    console.log(`Condition: ${conditionId.substring(0, 20)}...`);

    // Check CTF events
    const ctfResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          tx_hash,
          block_number,
          event_timestamp
        FROM pm_ctf_events
        WHERE lower(user_address) = lower('${WALLET}')
          AND condition_id = '${conditionId}'
        LIMIT 10
      `,
      format: 'JSONEachRow',
    });
    const ctfEvents = (await ctfResult.json()) as any[];
    console.log(`  CTF Events: ${ctfEvents.length}`);
    for (const e of ctfEvents) {
      console.log(`    ${e.event_type} @ block ${e.block_number}`);
    }

    // Check FPMM trades - need to join through pool map to get condition_id
    // First check if FPMM has any trades for this wallet at all
    const fpmmResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_fpmm_trades
        WHERE lower(trader_wallet) = lower('${WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const fpmmTrades = (await fpmmResult.json()) as any[];
    console.log(`  FPMM Trades (total for wallet): ${fpmmTrades[0]?.cnt}`)

    // Check if there might be a condition_id format issue
    // Try with 0x prefix
    const clobWithPrefixResult = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${WALLET}')
          AND (m.condition_id = '${conditionId}' OR m.condition_id = '0x${conditionId}')
          AND t.is_deleted = 0
      `,
      format: 'JSONEachRow',
    });
    const prefixRows = (await clobWithPrefixResult.json()) as any[];
    console.log(`  CLOB trades (with 0x variant): ${prefixRows[0]?.cnt}`);
  }

  // Now check what condition_ids V12 actually finds for this wallet
  console.log('\n' + '='.repeat(80));
  console.log('ALL CONDITION_IDS V12 MIGHT FIND');
  console.log('='.repeat(80));

  // All CLOB condition_ids
  const clobConditions = await clickhouse.query({
    query: `
      SELECT DISTINCT m.condition_id
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${WALLET}')
        AND t.is_deleted = 0
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });
  const clobIds = (await clobConditions.json()) as any[];
  console.log(`\nCLOB condition_ids: ${clobIds.length}`);

  // All CTF condition_ids
  const ctfConditions = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${WALLET}')
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });
  const ctfIds = (await ctfConditions.json()) as any[];
  console.log(`CTF condition_ids: ${ctfIds.length}`);

  // Check if any mismatched conditions are in CTF
  console.log('\nChecking mismatched conditions in CTF:');
  for (const conditionId of MISMATCHED_CONDITIONS) {
    const inCtf = ctfIds.some((c: any) => c.condition_id === conditionId);
    console.log(`  ${conditionId.substring(0, 20)}... in CTF: ${inCtf}`);
  }
}

main().catch(console.error);
