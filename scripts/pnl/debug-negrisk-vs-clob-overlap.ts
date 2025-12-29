/**
 * Debug NegRisk vs CLOB Overlap
 *
 * Check if NegRisk acquisitions are being double-counted with CLOB trades.
 *
 * Hypothesis: When a user does a NegRisk conversion, they receive tokens via ERC1155.
 * Those same tokens might also appear as CLOB buys at a different price, causing double-count.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
const CONDITION_ID = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';
const OUTCOME_INDEX = 1;

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG: NEGRISK vs CLOB OVERLAP');
  console.log('='.repeat(80));

  // Get CLOB buys for this position
  const clobQuery = `
    SELECT
      count() as row_count,
      uniqExact(event_id) as unique_events,
      sum(token_amount) / 1000000.0 as total_tokens,
      sum(usdc_amount) / 1000000.0 as total_usdc
    FROM pm_trader_events_v2 t
    WHERE lower(t.trader_wallet) = lower('${WALLET}')
      AND t.is_deleted = 0
      AND t.side = 'buy'
      AND t.token_id IN (
        SELECT token_id_dec
        FROM pm_token_to_condition_map_v3
        WHERE condition_id = '${CONDITION_ID}' AND outcome_index = ${OUTCOME_INDEX}
      )
  `;

  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobRows = (await clobResult.json()) as any[];
  console.log('\n=== CLOB BUYS (RAW) ===');
  console.log(`  Rows:           ${clobRows[0]?.row_count}`);
  console.log(`  Unique Events:  ${clobRows[0]?.unique_events}`);
  console.log(`  Total Tokens:   ${Number(clobRows[0]?.total_tokens).toLocaleString()}`);
  console.log(`  Total USDC:     $${Number(clobRows[0]?.total_usdc).toLocaleString()}`);

  // Get NegRisk acquisitions for this position
  const negriskQuery = `
    SELECT
      count() as row_count,
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
  const negriskRows = (await negriskResult.json()) as any[];
  console.log('\n=== NEGRISK ACQUISITIONS ===');
  console.log(`  Rows:         ${negriskRows[0]?.row_count}`);
  console.log(`  Total Tokens: ${Number(negriskRows[0]?.total_tokens).toLocaleString()}`);
  console.log(`  Total Cost:   $${Number(negriskRows[0]?.total_cost).toLocaleString()}`);

  // Check if there's any timing overlap
  // Get sample of NegRisk timestamps
  const negriskSampleQuery = `
    SELECT
      n.block_timestamp,
      n.shares,
      n.cost_basis_per_share,
      n.token_id_hex
    FROM vw_negrisk_conversions n
    INNER JOIN pm_token_to_condition_map_v3 m
      ON reinterpretAsUInt256(reverse(unhex(substring(n.token_id_hex, 3)))) = toUInt256(m.token_id_dec)
    WHERE lower(n.wallet) = lower('${WALLET}')
      AND m.condition_id = '${CONDITION_ID}'
      AND m.outcome_index = ${OUTCOME_INDEX}
    ORDER BY n.block_timestamp
    LIMIT 5
  `;

  const negriskSampleResult = await clickhouse.query({ query: negriskSampleQuery, format: 'JSONEachRow' });
  const negriskSample = (await negriskSampleResult.json()) as any[];
  console.log('\n=== SAMPLE NEGRISK ENTRIES ===');
  for (const r of negriskSample) {
    console.log(`  ${r.block_timestamp}: ${Number(r.shares).toLocaleString()} @ $${r.cost_basis_per_share}`);
  }

  // Check for CLOB buys around the same time
  if (negriskSample.length > 0) {
    const firstTime = negriskSample[0].block_timestamp;
    const clobAroundTimeQuery = `
      SELECT
        any(trade_time) as time,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc,
        event_id
      FROM pm_trader_events_v2 t
      WHERE lower(t.trader_wallet) = lower('${WALLET}')
        AND t.is_deleted = 0
        AND t.side = 'buy'
        AND t.token_id IN (
          SELECT token_id_dec
          FROM pm_token_to_condition_map_v3
          WHERE condition_id = '${CONDITION_ID}' AND outcome_index = ${OUTCOME_INDEX}
        )
        AND t.trade_time >= toDateTime('${firstTime}') - INTERVAL 1 HOUR
        AND t.trade_time <= toDateTime('${firstTime}') + INTERVAL 1 HOUR
      GROUP BY event_id
      ORDER BY time
      LIMIT 10
    `;

    const clobAroundResult = await clickhouse.query({ query: clobAroundTimeQuery, format: 'JSONEachRow' });
    const clobAround = (await clobAroundResult.json()) as any[];
    console.log('\n=== CLOB BUYS AROUND FIRST NEGRISK ===');
    for (const r of clobAround) {
      console.log(`  ${r.time}: ${Number(r.tokens).toLocaleString()} tokens for $${Number(r.usdc).toLocaleString()}`);
    }
  }

  // KEY CHECK: What's the overall wallet PnL according to UI?
  // The UI uses their own calculation - let's see if there's a "ui_pnl_est" field
  const uiPnlQuery = `
    SELECT
      ui_pnl_est,
      net_profit_loss
    FROM vw_wallet_pnl_summary
    WHERE lower(wallet) = lower('${WALLET}')
    LIMIT 1
  `;

  try {
    const uiResult = await clickhouse.query({ query: uiPnlQuery, format: 'JSONEachRow' });
    const uiRows = (await uiResult.json()) as any[];
    if (uiRows.length > 0) {
      console.log('\n=== UI PNL FROM VIEW ===');
      console.log(`  ui_pnl_est: $${Number(uiRows[0]?.ui_pnl_est).toLocaleString()}`);
      console.log(`  net_profit_loss: $${Number(uiRows[0]?.net_profit_loss).toLocaleString()}`);
    }
  } catch (err) {
    console.log('\n=== UI PNL FROM VIEW ===');
    console.log('  View does not exist or error:', (err as Error).message.substring(0, 60));
  }

  // Check what Polymarket API says
  console.log('\n='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`CLOB Buys:     ${Number(clobRows[0]?.total_tokens).toLocaleString()} tokens`);
  console.log(`NegRisk Acq:   ${Number(negriskRows[0]?.total_tokens).toLocaleString()} tokens`);
  console.log(`TOTAL:         ${(Number(clobRows[0]?.total_tokens) + Number(negriskRows[0]?.total_tokens)).toLocaleString()} tokens`);
  console.log(`Expected:      13,590,277 tokens (from static analysis)`);
}

main().catch(console.error);
