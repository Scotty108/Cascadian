/**
 * Verify NegRisk/CLOB Double Count
 *
 * The hypothesis: NegRisk conversions appear as BOTH:
 * 1. vw_negrisk_conversions entries at $0.50
 * 2. pm_trader_events_v2 CLOB buys at market price
 *
 * This causes double-counting and inflates the cost basis.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
const CONDITION_ID = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
const OUTCOME_INDEX = 1;

async function main() {
  console.log('='.repeat(80));
  console.log('VERIFY: NEGRISK/CLOB DOUBLE COUNT');
  console.log('='.repeat(80));

  // Get the first NegRisk entry
  const negriskQuery = `
    SELECT
      n.block_timestamp,
      n.shares,
      n.cost_basis_per_share,
      n.token_id_hex,
      m.token_id_dec
    FROM vw_negrisk_conversions n
    INNER JOIN pm_token_to_condition_map_v3 m
      ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
    WHERE lower(n.wallet) = lower('${WALLET}')
      AND m.condition_id = '${CONDITION_ID}'
      AND m.outcome_index = ${OUTCOME_INDEX}
    ORDER BY n.block_timestamp
    LIMIT 1
  `;

  const negriskResult = await clickhouse.query({ query: negriskQuery, format: 'JSONEachRow' });
  const negrisk = (await negriskResult.json()) as any[];

  if (negrisk.length === 0) {
    console.log('No NegRisk entries found');
    return;
  }

  const nr = negrisk[0];
  console.log('\n=== FIRST NEGRISK ENTRY ===');
  console.log(`  Timestamp:  ${nr.block_timestamp}`);
  console.log(`  Shares:     ${nr.shares}`);
  console.log(`  Cost Basis: $${nr.cost_basis_per_share}`);
  console.log(`  Token Hex:  ${nr.token_id_hex}`);
  console.log(`  Token Dec:  ${nr.token_id_dec}`);

  // Now check if there's a CLOB trade at the exact same timestamp with same quantity
  const clobQuery = `
    SELECT
      event_id,
      trade_time,
      token_amount / 1000000.0 as tokens,
      usdc_amount / 1000000.0 as usdc,
      side
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
      AND token_id = '${nr.token_id_dec}'
      AND trade_time = toDateTime('${nr.block_timestamp}')
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clob = (await clobResult.json()) as any[];

  console.log('\n=== CLOB TRADES AT SAME TIMESTAMP ===');
  if (clob.length === 0) {
    console.log('  None found - NegRisk is separate from CLOB');
  } else {
    for (const c of clob) {
      console.log(`  Event ${c.event_id}: ${c.side} ${Number(c.tokens).toFixed(2)} tokens for $${Number(c.usdc).toFixed(2)}`);
    }
    console.log(`\n  FOUND ${clob.length} MATCHING CLOB TRADES!`);
    console.log('  This confirms double-counting.');
  }

  // Check how many total NegRisk entries have matching CLOB entries
  const overlapQuery = `
    SELECT count() as overlap_count
    FROM vw_negrisk_conversions n
    INNER JOIN pm_token_to_condition_map_v3 m
      ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
    INNER JOIN pm_trader_events_v2 t
      ON t.token_id = m.token_id_dec
      AND lower(t.trader_wallet) = lower(n.wallet)
      AND t.trade_time = toDateTime(n.block_timestamp)
    WHERE lower(n.wallet) = lower('${WALLET}')
      AND m.condition_id = '${CONDITION_ID}'
      AND m.outcome_index = ${OUTCOME_INDEX}
      AND t.is_deleted = 0
  `;

  const overlapResult = await clickhouse.query({ query: overlapQuery, format: 'JSONEachRow' });
  const overlap = (await overlapResult.json()) as any[];

  console.log('\n=== TOTAL OVERLAP COUNT ===');
  console.log(`  ${overlap[0]?.overlap_count} NegRisk entries have matching CLOB trades`);

  // What percent of NegRisk entries overlap?
  const totalNegrisk = negrisk.length;
  const totalQuery = `
    SELECT count() as total
    FROM vw_negrisk_conversions n
    INNER JOIN pm_token_to_condition_map_v3 m
      ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
    WHERE lower(n.wallet) = lower('${WALLET}')
      AND m.condition_id = '${CONDITION_ID}'
      AND m.outcome_index = ${OUTCOME_INDEX}
  `;

  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const total = (await totalResult.json()) as any[];

  console.log(`  Total NegRisk entries: ${total[0]?.total}`);
  console.log(`  Overlap rate: ${((overlap[0]?.overlap_count / total[0]?.total) * 100).toFixed(1)}%`);

  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  if (overlap[0]?.overlap_count > 0) {
    console.log('NegRisk conversions ARE being double-counted with CLOB trades!');
    console.log('The fix: Either:');
    console.log('  1. Exclude NegRisk acquisitions (use CLOB only)');
    console.log('  2. Exclude CLOB buys that have matching NegRisk timestamps');
    console.log('  3. Use CLOB as source of truth and ignore vw_negrisk_conversions');
  } else {
    console.log('No overlap found - the issue is elsewhere.');
  }
}

main().catch(console.error);
