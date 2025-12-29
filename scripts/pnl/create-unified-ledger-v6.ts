/**
 * Create pm_unified_ledger_v6 view
 *
 * Fixed version that uses role='maker' for CLOB trades to match V18 semantics.
 * V5 included both maker AND taker, causing 2x inflation.
 *
 * Changes from V5:
 * - Added role = 'maker' filter for CLOB trades
 * - This ensures each trade is counted once (from maker's perspective)
 */

import { clickhouse } from '../../lib/clickhouse/client';

const VIEW_NAME = 'pm_unified_ledger_v6';

async function main() {
  console.log('Creating pm_unified_ledger_v6 (FIXED with role=maker)...');
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
    -- CLOB trades (deduplicated by event_id, MAKER ONLY to match V18)
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
      -- Deduplicate CLOB trades by event_id
      -- CRITICAL: role='maker' to match V18 and avoid 2x inflation
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
        AND role = 'maker'  -- KEY FIX: Only include maker trades (V5 had both maker+taker)
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
    console.log('Successfully created pm_unified_ledger_v6');
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

  // Compare V5 vs V6 for Anon wallet
  console.log('');
  console.log('Comparing V5 vs V6 CLOB counts for Anon wallet...');

  const v5Res = await clickhouse.query({
    query: `
      SELECT count() as cnt, sum(usdc_delta) as usdc_sum, sum(token_delta) as token_sum
      FROM pm_unified_ledger_v5
      WHERE lower(wallet_address) = lower('0x62fadaf110588be0d8fcf2c711bae31051bb50a9')
        AND source_type = 'CLOB'
    `,
    format: 'JSONEachRow',
  });
  const v5 = (await v5Res.json()) as any[];

  const v6Res = await clickhouse.query({
    query: `
      SELECT count() as cnt, sum(usdc_delta) as usdc_sum, sum(token_delta) as token_sum
      FROM ${VIEW_NAME}
      WHERE lower(wallet_address) = lower('0x62fadaf110588be0d8fcf2c711bae31051bb50a9')
        AND source_type = 'CLOB'
    `,
    format: 'JSONEachRow',
  });
  const v6 = (await v6Res.json()) as any[];

  console.log(`  V5: ${v5[0]?.cnt || 0} CLOB events, $${Number(v5[0]?.usdc_sum || 0).toFixed(2)} USDC`);
  console.log(`  V6: ${v6[0]?.cnt || 0} CLOB events, $${Number(v6[0]?.usdc_sum || 0).toFixed(2)} USDC`);
  console.log(`  Ratio: ${(Number(v5[0]?.cnt) / Number(v6[0]?.cnt)).toFixed(2)}x`);

  console.log('');
  console.log('Done.');
}

main().catch(console.error);
