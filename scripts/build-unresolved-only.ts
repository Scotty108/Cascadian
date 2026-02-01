#!/usr/bin/env npx tsx
/**
 * Build Fresh Unresolved Positions
 *
 * Builds only the unresolved positions (last 24h of wallet activity)
 * Can run in parallel with resolved copy operation
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const TARGET_TABLE = 'pm_trade_fifo_roi_v3_mat_unified_v2';

async function buildUnresolvedPositions() {
  console.log('🔄 Building Fresh Unresolved Positions\n');
  console.log(`Target table: ${TARGET_TABLE}\n`);

  const startTime = Date.now();

  // Find wallets active in last 24 hours
  console.log('1️⃣ Finding active wallets...');
  const walletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 24 HOUR
        AND wallet != '0x0000000000000000000000000000000000000000'
        AND source = 'clob'
    `,
    format: 'JSONEachRow',
  });
  const wallets = (await walletsResult.json<{ wallet: string }>()).map(w => w.wallet);
  console.log(`   ✅ Found ${wallets.length.toLocaleString()} active wallets\n`);

  // Process in batches
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(wallets.length / BATCH_SIZE);

  console.log(`2️⃣ Processing ${totalBatches} batches...\n`);

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length));
    const batchWallets = batch.map(w => `'${w}'`).join(',');

    if (batchNum % 10 === 0 || batchNum === 1) {
      console.log(`   Batch ${batchNum}/${totalBatches}...`);
    }

    // Insert LONG positions (unresolved only)
    await clickhouse.command({
      query: `
        INSERT INTO ${TARGET_TABLE}
        SELECT
          buys.tx_hash,
          buys.wallet,
          buys.condition_id,
          buys.outcome_index,
          buys.entry_time,
          NULL as resolved_at,
          buys.tokens,
          buys.cost_usd,
          0 as tokens_sold_early,
          buys.tokens as tokens_held,
          0 as exit_value,
          0 as pnl_usd,
          0 as roi,
          0 as pct_sold_early,
          buys.is_maker_flag as is_maker,
          0 as is_closed,
          0 as is_short
        FROM (
          SELECT
            tx_hash,
            wallet,
            condition_id,
            outcome_index,
            min(event_time) as entry_time,
            sum(tokens_delta) as tokens,
            sum(abs(usdc_delta)) as cost_usd,
            max(is_maker) as is_maker_flag
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${batchWallets}]
            AND source = 'clob'
            AND tokens_delta > 0
            AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY tx_hash, wallet, condition_id, outcome_index
          HAVING cost_usd >= 0.01 AND tokens >= 0.01
        ) AS buys
        LEFT JOIN pm_condition_resolutions AS r
          ON buys.condition_id = r.condition_id
          AND r.is_deleted = 0
          AND r.payout_numerators != ''
        WHERE r.condition_id IS NULL
      `,
      clickhouse_settings: {
        max_execution_time: 600,
      }
    });

    // Insert SHORT positions (unresolved only)
    await clickhouse.command({
      query: `
        INSERT INTO ${TARGET_TABLE}
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
          FROM pm_canonical_fills_v4
          WHERE wallet IN [${batchWallets}]
            AND source = 'clob'
            AND wallet != '0x0000000000000000000000000000000000000000'
            AND NOT (is_self_fill = 1 AND is_maker = 1)
          GROUP BY wallet, condition_id, outcome_index
          HAVING net_tokens < -0.01 AND cash_flow > 0.01
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
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ UNRESOLVED POSITIONS COMPLETE! (${totalTime} minutes)\n`);
}

buildUnresolvedPositions().catch(console.error);
