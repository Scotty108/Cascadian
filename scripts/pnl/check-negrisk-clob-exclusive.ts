/**
 * Check if NegRisk and CLOB are Exclusive
 *
 * Key question: Are NegRisk acquisitions separate from CLOB buys,
 * or are they the same trades appearing in both systems?
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
const CONDITION_ID = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
const OUTCOME_INDEX = 1;

async function main() {
  console.log('='.repeat(80));
  console.log('CHECK: ARE NEGRISK AND CLOB EXCLUSIVE?');
  console.log('='.repeat(80));

  // Get CLOB buys after proper deduplication
  const clobQuery = `
    SELECT
      sum(tokens) as total_tokens,
      sum(usdc) as total_usdc,
      count() as num_trades
    FROM (
      SELECT
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2 t
      WHERE lower(t.trader_wallet) = lower('${WALLET}')
        AND t.is_deleted = 0
        AND t.side = 'buy'
        AND t.token_id IN (
          SELECT token_id_dec
          FROM pm_token_to_condition_map_v3
          WHERE condition_id = '${CONDITION_ID}' AND outcome_index = ${OUTCOME_INDEX}
        )
      GROUP BY event_id
    )
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobData = (await clobResult.json()) as any[];
  console.log('\n=== CLOB BUYS (deduped) ===');
  console.log(`  Trades:  ${clobData[0]?.num_trades}`);
  console.log(`  Tokens:  ${Number(clobData[0]?.total_tokens).toLocaleString()}`);
  console.log(`  USDC:    $${Number(clobData[0]?.total_usdc).toLocaleString()}`);

  // Get NegRisk acquisitions
  const negriskQuery = `
    SELECT
      count() as num_entries,
      sum(n.shares) as total_tokens,
      sum(n.shares * n.cost_basis_per_share) as total_cost
    FROM vw_negrisk_conversions n
    INNER JOIN pm_token_to_condition_map_v3 m
      ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
    WHERE lower(n.wallet) = lower('${WALLET}')
      AND m.condition_id = '${CONDITION_ID}'
      AND m.outcome_index = ${OUTCOME_INDEX}
  `;

  const negriskResult = await clickhouse.query({ query: negriskQuery, format: 'JSONEachRow' });
  const negriskData = (await negriskResult.json()) as any[];
  console.log('\n=== NEGRISK ACQUISITIONS ===');
  console.log(`  Entries: ${negriskData[0]?.num_entries}`);
  console.log(`  Tokens:  ${Number(negriskData[0]?.total_tokens).toLocaleString()}`);
  console.log(`  Cost:    $${Number(negriskData[0]?.total_cost).toLocaleString()}`);

  // Now the KEY test: Check how many NegRisk tokens match CLOB buys
  // by comparing timestamps and quantities
  const overlapQuery = `
    SELECT
      sum(n.shares) as overlap_tokens
    FROM vw_negrisk_conversions n
    INNER JOIN pm_token_to_condition_map_v3 m
      ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
    WHERE lower(n.wallet) = lower('${WALLET}')
      AND m.condition_id = '${CONDITION_ID}'
      AND m.outcome_index = ${OUTCOME_INDEX}
      AND EXISTS (
        SELECT 1 FROM pm_trader_events_v2 t
        WHERE lower(t.trader_wallet) = lower('${WALLET}')
          AND t.is_deleted = 0
          AND t.side = 'buy'
          AND t.token_id = m.token_id_dec
          AND toDate(t.trade_time) = toDate(n.block_timestamp)
      )
  `;

  const overlapResult = await clickhouse.query({ query: overlapQuery, format: 'JSONEachRow' });
  const overlapData = (await overlapResult.json()) as any[];
  console.log('\n=== OVERLAP CHECK ===');
  console.log(`  NegRisk tokens that have same-day CLOB buys: ${Number(overlapData[0]?.overlap_tokens).toLocaleString()}`);

  const negriskTokens = Number(negriskData[0]?.total_tokens);
  const overlapTokens = Number(overlapData[0]?.overlap_tokens);
  const overlapPct = negriskTokens > 0 ? (overlapTokens / negriskTokens * 100) : 0;
  console.log(`  Overlap %: ${overlapPct.toFixed(1)}%`);

  console.log('\n=== STATIC ANALYSIS COMPARISON ===');
  const staticClobBuy = 10806176.653;
  const staticNegrisk = 2784100.387;
  const staticTotal = staticClobBuy + staticNegrisk;

  console.log(`  Static CLOB:    ${staticClobBuy.toLocaleString()}`);
  console.log(`  Static NegRisk: ${staticNegrisk.toLocaleString()}`);
  console.log(`  Static Total:   ${staticTotal.toLocaleString()}`);
  console.log(`  This Query CLOB: ${Number(clobData[0]?.total_tokens).toLocaleString()}`);
  console.log(`  This Query NR:   ${Number(negriskData[0]?.total_tokens).toLocaleString()}`);

  // Check if they MATCH
  const queryTotal = Number(clobData[0]?.total_tokens) + Number(negriskData[0]?.total_tokens);
  console.log(`  This Query Total: ${queryTotal.toLocaleString()}`);

  // If overlap is 100%, NegRisk is a subset of CLOB - shouldn't add them
  // If overlap is 0%, they're exclusive - should add them

  console.log('\n' + '='.repeat(80));
  console.log('INTERPRETATION');
  console.log('='.repeat(80));

  if (overlapPct > 90) {
    console.log('NegRisk entries OVERLAP with CLOB buys (>90%).');
    console.log('CONCLUSION: Should NOT add NegRisk to CLOB - they are the same trades.');
    console.log('The $0.50 cost basis from NegRisk should REPLACE the CLOB price.');
  } else if (overlapPct < 10) {
    console.log('NegRisk entries are mostly EXCLUSIVE from CLOB (<10% overlap).');
    console.log('CONCLUSION: Should ADD NegRisk to CLOB - they are separate acquisitions.');
  } else {
    console.log(`Partial overlap (${overlapPct.toFixed(1)}%) - need further investigation.`);
  }
}

main().catch(console.error);
