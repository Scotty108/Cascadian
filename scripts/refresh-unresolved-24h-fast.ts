#!/usr/bin/env npx tsx
/**
 * Fast Unresolved Refresh (24-hour lookback)
 *
 * Refreshes unresolved positions for wallets active in last 24 hours
 * WITHOUT temp tables (avoids session issues)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const LOOKBACK_HOURS = 24;
const BATCH_SIZE = 500;

async function refreshUnresolved24h() {
  console.log('🔄 Fast Unresolved Refresh (24h lookback)\\n');
  console.log(`Started at: ${new Date().toISOString()}\\n`);

  // Step 1: Get active wallets
  console.log('1️⃣ Finding active wallets...');
  const walletsResult = await clickhouse.query({
    query: `
      WITH deduped_events AS (
        SELECT
          event_id,
          any(trader_wallet) as wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL ${LOOKBACK_HOURS} HOUR
        GROUP BY event_id
      )
      SELECT DISTINCT wallet
      FROM deduped_events
      WHERE wallet != '0x0000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  });

  const wallets = (await walletsResult.json<{ wallet: string }>()).map(w => w.wallet);
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} active wallets\\n`);

  if (wallets.length === 0) {
    console.log('No wallets to process.\\n');
    return;
  }

  // Step 2: Process in batches
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);
  let processed = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length));
    const walletList = batch.map(w => `'${w}'`).join(', ');

    console.log(`2️⃣ Batch ${batchNum}/${totalBatches} (${batch.length} wallets)...`);

    // Process LONG positions (direct INSERT with LEFT JOIN anti-pattern)
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          longs.tx_hash,
          longs.wallet,
          longs.condition_id,
          longs.outcome_index,
          longs.entry_time,
          NULL as resolved_at,
          longs.tokens,
          longs.cost_usd,
          0 as tokens_sold_early,
          longs.tokens as tokens_held,
          0 as exit_value,
          0 as pnl_usd,
          0 as roi,
          0 as pct_sold_early,
          longs.is_maker_flag as is_maker,
          0 as is_closed,
          0 as is_short
        FROM (
          SELECT
            _tx_hash as tx_hash,
            _wallet as wallet,
            _condition_id as condition_id,
            _outcome_index as outcome_index,
            min(_event_time) as entry_time,
            sum(_tokens_delta) as tokens,
            sum(abs(_usdc_delta)) as cost_usd,
            max(_is_maker) as is_maker_flag
          FROM (
            SELECT
              fill_id,
              any(tx_hash) as _tx_hash,
              any(event_time) as _event_time,
              any(wallet) as _wallet,
              any(condition_id) as _condition_id,
              any(outcome_index) as _outcome_index,
              any(tokens_delta) as _tokens_delta,
              any(usdc_delta) as _usdc_delta,
              any(is_maker) as _is_maker,
              any(is_self_fill) as _is_self_fill,
              any(source) as _source
            FROM pm_canonical_fills_v4
            WHERE wallet IN [${walletList}]
              AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE _source = 'clob'
            AND _tokens_delta > 0
            AND _wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (_is_self_fill = 1 AND _is_maker = 1)
          GROUP BY _tx_hash, _wallet, _condition_id, _outcome_index
          HAVING cost_usd >= 0.01
            AND tokens >= 0.01
        ) AS longs
        LEFT JOIN pm_condition_resolutions AS r
          ON longs.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 600,  // 10 minutes per batch
      }
    });

    // Process SHORT positions
    await clickhouse.command({
      query: `
        INSERT INTO pm_trade_fifo_roi_v3_mat_unified
        SELECT
          concat('short_', substring(shorts.wallet, 1, 10), '_', substring(shorts.condition_id, 1, 10), '_', toString(shorts.outcome_index), '_', toString(toUnixTimestamp(shorts.entry_time))) as tx_hash,
          shorts.wallet,
          shorts.condition_id,
          shorts.outcome_index,
          shorts.entry_time,
          NULL as resolved_at,
          abs(shorts.net_tokens) as tokens,
          -shorts.cash_flow as cost_usd,
          0 as tokens_sold_early,
          abs(shorts.net_tokens) as tokens_held,
          0 as exit_value,
          0 as pnl_usd,
          0 as roi,
          0 as pct_sold_early,
          0 as is_maker,
          0 as is_closed,
          1 as is_short
        FROM (
          SELECT
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            sum(tokens_delta) as net_tokens,
            sum(usdc_delta) as cash_flow
          FROM (
            SELECT
              fill_id,
              any(event_time) as event_time,
              any(wallet) as wallet,
              any(condition_id) as condition_id,
              any(outcome_index) as outcome_index,
              any(tokens_delta) as tokens_delta,
              any(usdc_delta) as usdc_delta,
              any(source) as source,
              any(is_self_fill) as is_self_fill,
              any(is_maker) as is_maker
            FROM pm_canonical_fills_v4
            WHERE wallet IN [${walletList}]
              AND source = 'clob'
            GROUP BY fill_id
          )
          WHERE source = 'clob'
            AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING net_tokens < -0.01
            AND cash_flow > 0.01
        ) AS shorts
        LEFT JOIN pm_condition_resolutions AS r
          ON shorts.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });

    processed += batch.length;
    const pct = (processed / wallets.length * 100).toFixed(1);
    console.log(`   ✅ Processed ${processed.toLocaleString()}/${wallets.length.toLocaleString()} (${pct}%)\\n`);
  }

  console.log('3️⃣ Refresh complete!');
  console.log(`   Finished at: ${new Date().toISOString()}\\n`);

  // Show final stats
  const statsResult = await clickhouse.query({
    query: `
      SELECT
        max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved,
        date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as minutes_stale
      FROM pm_trade_fifo_roi_v3_mat_unified
    `,
    format: 'JSONEachRow'
  });

  const stats = (await statsResult.json())[0];
  console.log('📊 Final Stats:');
  console.log(`   Newest unresolved entry: ${stats.newest_unresolved}`);
  console.log(`   Minutes stale: ${stats.minutes_stale} (${(stats.minutes_stale / 60).toFixed(1)} hours)\\n`);
}

refreshUnresolved24h().catch(console.error);
