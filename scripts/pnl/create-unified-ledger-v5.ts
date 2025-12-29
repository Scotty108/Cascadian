/**
 * Create pm_unified_ledger_v5 view
 *
 * This view provides a unified ledger of all wallet activity with proper deduplication:
 * - CLOB trades: deduplicated by event_id with GROUP BY
 * - CTF events: PositionSplit, PositionsMerge, PayoutRedemption
 * - Includes resolution info (payout_numerators_norm) for each event
 */

import { clickhouse } from '../../lib/clickhouse/client';

const VIEW_NAME = 'pm_unified_ledger_v5';

async function main() {
  console.log('Creating pm_unified_ledger_v5...');
  console.log('');

  // First, drop existing view if it exists
  try {
    await clickhouse.command({
      query: `DROP VIEW IF EXISTS ${VIEW_NAME}`,
    });
    console.log('Dropped existing view');
  } catch (e: unknown) {
    console.log('No existing view to drop');
  }

  // Create the new view
  const createViewQuery = `
    CREATE VIEW ${VIEW_NAME} AS
    -- CLOB trades (deduplicated by event_id within each wallet+token combo)
    SELECT
      'CLOB' AS source_type,
      t.wallet AS wallet_address,
      m.condition_id AS condition_id,
      m.outcome_index AS outcome_index,
      t.trade_time AS event_time,
      t.event_id AS event_id,
      -- Cash delta: buy = negative (outflow), sell = positive (inflow)
      if(t.side = 'buy', -t.usdc_amount, t.usdc_amount) AS usdc_delta,
      -- Token delta: buy = positive, sell = negative
      if(t.side = 'buy', t.token_amount, -t.token_amount) AS token_delta,
      -- Resolution info (nullable for unresolved)
      r.payout_numerators AS payout_numerators,
      -- Normalized payout for this outcome (0 or 1)
      if(r.payout_numerators IS NOT NULL,
         if(JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000, 1,
            JSONExtractInt(r.payout_numerators, m.outcome_index + 1)),
         NULL) AS payout_norm
    FROM (
      -- Deduplicate CLOB trades by event_id + wallet (maker and taker are separate entries)
      SELECT
        event_id,
        trader_wallet AS wallet,
        any(side) AS side,
        any(usdc_amount) / 1e6 AS usdc_amount,
        any(token_amount) / 1e6 AS token_amount,
        any(trade_time) AS trade_time,
        any(token_id) AS token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY event_id, trader_wallet
    ) AS t
    LEFT JOIN pm_token_to_condition_map_v3 AS m ON t.token_id = m.token_id_dec
    LEFT JOIN pm_condition_resolutions AS r ON m.condition_id = r.condition_id

    UNION ALL

    -- CTF Position Splits (cash outflow to mint tokens)
    SELECT
      'PositionSplit' AS source_type,
      c.user_address AS wallet_address,
      c.condition_id AS condition_id,
      0 AS outcome_index,  -- Splits affect all outcomes equally
      c.event_timestamp AS event_time,
      c.id AS event_id,
      -toFloat64OrZero(c.amount_or_payout) / 1e6 AS usdc_delta,  -- Cash outflow
      toFloat64OrZero(c.amount_or_payout) / 1e6 AS token_delta,  -- Tokens created
      r.payout_numerators AS payout_numerators,
      NULL AS payout_norm  -- Not applicable for splits
    FROM pm_ctf_events AS c
    LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
    WHERE c.is_deleted = 0 AND c.event_type = 'PositionSplit'

    UNION ALL

    -- CTF Position Merges (cash inflow from burning tokens)
    SELECT
      'PositionsMerge' AS source_type,
      c.user_address AS wallet_address,
      c.condition_id AS condition_id,
      0 AS outcome_index,  -- Merges affect all outcomes equally
      c.event_timestamp AS event_time,
      c.id AS event_id,
      toFloat64OrZero(c.amount_or_payout) / 1e6 AS usdc_delta,  -- Cash inflow
      -toFloat64OrZero(c.amount_or_payout) / 1e6 AS token_delta,  -- Tokens burned
      r.payout_numerators AS payout_numerators,
      NULL AS payout_norm  -- Not applicable for merges
    FROM pm_ctf_events AS c
    LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
    WHERE c.is_deleted = 0 AND c.event_type = 'PositionsMerge'

    UNION ALL

    -- CTF Payout Redemptions (cash inflow from winning tokens)
    SELECT
      'PayoutRedemption' AS source_type,
      c.user_address AS wallet_address,
      c.condition_id AS condition_id,
      0 AS outcome_index,  -- We don't know which outcome was redeemed
      c.event_timestamp AS event_time,
      c.id AS event_id,
      toFloat64OrZero(c.amount_or_payout) / 1e6 AS usdc_delta,  -- Cash inflow
      -toFloat64OrZero(c.amount_or_payout) / 1e6 AS token_delta,  -- Tokens burned
      r.payout_numerators AS payout_numerators,
      1 AS payout_norm  -- Redemptions only happen on winners
    FROM pm_ctf_events AS c
    LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
    WHERE c.is_deleted = 0 AND c.event_type = 'PayoutRedemption'
  `;

  try {
    await clickhouse.command({ query: createViewQuery });
    console.log('Successfully created pm_unified_ledger_v5');
  } catch (e: unknown) {
    console.error('Error creating view:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // Verify the view
  console.log('');
  console.log('Verifying view structure...');
  const descRes = await clickhouse.query({
    query: `DESCRIBE ${VIEW_NAME}`,
    format: 'JSONEachRow',
  });
  const cols = (await descRes.json()) as any[];
  console.log('');
  console.log('Columns:');
  for (const col of cols) {
    console.log('  ' + col.name + ': ' + col.type);
  }

  // Test with a sample
  console.log('');
  console.log('Sample data for W2...');
  const sampleRes = await clickhouse.query({
    query: `
      SELECT source_type, count() as cnt, sum(usdc_delta) as usdc_sum
      FROM ${VIEW_NAME}
      WHERE wallet_address = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'
      GROUP BY source_type
      ORDER BY source_type
    `,
    format: 'JSONEachRow',
  });
  const sample = (await sampleRes.json()) as any[];
  for (const s of sample) {
    console.log('  ' + s.source_type + ': ' + s.cnt + ' events, $' + s.usdc_sum.toFixed(2));
  }

  console.log('');
  console.log('Done.');
}

main().catch(console.error);
