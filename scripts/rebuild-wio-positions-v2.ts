/**
 * WIO Positions V2 Rebuild Script
 *
 * Rebuilds wio_positions_v2 using V1 engine logic:
 * - Excludes source='negrisk' (internal mechanism transfers)
 * - Excludes maker side of self-fills
 * - Handles [1,1] cancelled market payouts (50% each)
 * - Calculates proper pnl_usd using: cash_flow + long_wins - short_losses
 *
 * Batched approach to avoid memory issues:
 * - Processes wallets in batches by prefix (0x0, 0x1, ..., 0xf)
 * - Each batch is processed separately and inserted into the final table
 *
 * @author Claude Code
 * @date 2026-01-13
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

// Use 256 prefixes for smaller memory footprint per batch
const WALLET_PREFIXES: string[] = [];
for (const a of '0123456789abcdef') {
  for (const b of '0123456789abcdef') {
    WALLET_PREFIXES.push(`0x${a}${b}`);
  }
}

async function rebuildWioPositions() {
  console.log('='.repeat(60));
  console.log('WIO Positions V2 Rebuild (Batched)');
  console.log('Using V1 Engine Logic (NegRisk excluded, [1,1] handling)');
  console.log('='.repeat(60));
  console.log('');

  // Step 1: Skip stats query (times out on large tables)
  console.log('Step 1: Skipping stats query (table too large)...');
  console.log('');

  // Step 2: Drop temporary table and create new table
  console.log('Step 2: Setting up new table...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS wio_positions_v2_new`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE wio_positions_v2_new (
        position_id UInt64,
        wallet_id String,
        condition_id String,
        outcome_index UInt8,
        market_id String DEFAULT '',
        side String,
        category String DEFAULT '',
        primary_bundle_id String DEFAULT '',
        event_id String DEFAULT '',
        ts_open DateTime,
        ts_close Nullable(DateTime),
        ts_resolve Nullable(DateTime),
        end_ts DateTime,
        net_tokens Float64,
        net_cash Float64,
        qty_shares_opened Float64,
        qty_shares_closed Float64,
        qty_shares_remaining Float64,
        cost_usd Float64,
        proceeds_usd Float64,
        fees_usd Float64 DEFAULT 0,
        p_entry_side Float64,
        p_anchor_4h_side Nullable(Float64),
        p_anchor_24h_side Nullable(Float64),
        p_anchor_72h_side Nullable(Float64),
        is_resolved UInt8 DEFAULT 0,
        payout_rate Float64 DEFAULT 0,
        outcome_side Nullable(UInt8),
        pnl_usd Float64 DEFAULT 0,
        roi Float64 DEFAULT 0,
        hold_minutes Int64 DEFAULT 0,
        clv_4h Nullable(Float64),
        clv_24h Nullable(Float64),
        clv_72h Nullable(Float64),
        brier_score Nullable(Float64),
        fills_count Int32 DEFAULT 0,
        first_fill_id String DEFAULT '',
        last_fill_id String DEFAULT '',
        created_at DateTime DEFAULT now(),
        updated_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (wallet_id, condition_id, outcome_index)
      PARTITION BY substring(wallet_id, 1, 4)
    `
  });
  console.log('Done.');
  console.log('');

  // Step 3: Process each wallet prefix batch
  const startTime = Date.now();
  let totalInserted = 0;

  console.log('Step 3: Processing wallets in batches by prefix...');
  for (let i = 0; i < WALLET_PREFIXES.length; i++) {
    const prefix = WALLET_PREFIXES[i];
    const batchStart = Date.now();

    console.log(`  [${i + 1}/${WALLET_PREFIXES.length}] Processing ${prefix}*...`);

    await clickhouse.command({
      query: `
        INSERT INTO wio_positions_v2_new
        SELECT
          -- Identity
          cityHash64(concat(f.wallet, f.condition_id, toString(f.outcome_index))) as position_id,
          f.wallet as wallet_id,
          f.condition_id as condition_id,
          f.outcome_index as outcome_index,
          ifNull(m.market_id, '') as market_id,
          IF(f.net_tokens >= 0, 'YES', 'NO') as side,

          -- Taxonomy
          ifNull(m.category, '') as category,
          ifNull(b.primary_bundle_id, '') as primary_bundle_id,
          ifNull(b.event_id, '') as event_id,

          -- Timestamps
          f.ts_open as ts_open,
          IF(f.qty_bought > 0 AND f.qty_sold >= f.qty_bought, f.ts_last_fill, NULL) as ts_close,
          r.resolved_at as ts_resolve,
          coalesce(
            IF(f.qty_bought > 0 AND f.qty_sold >= f.qty_bought, f.ts_last_fill, NULL),
            r.resolved_at,
            now()
          ) as end_ts,

          -- Token flows
          f.net_tokens as net_tokens,
          f.net_cash as net_cash,
          f.qty_bought as qty_shares_opened,
          f.qty_sold as qty_shares_closed,
          f.qty_bought - f.qty_sold as qty_shares_remaining,

          -- Financials
          -- For LONG positions: cost = cash spent buying
          -- For SHORT positions: cost = collateral posted = (shares * $1) - proceeds
          --   Example: Sell 100 NO at 38¢ = $38 proceeds, collateral = $100-$38 = $62
          -- NOTE: Use >= to handle fully closed positions (qty_bought == qty_sold) as LONGs
          IF(f.qty_bought >= f.qty_sold,
            f.cost_usd,
            (f.qty_sold - f.qty_bought) - f.proceeds_usd  -- Collateral = risk capital for shorts
          ) as cost_usd,
          f.proceeds_usd as proceeds_usd,
          0 as fees_usd,

          -- Entry price (for longs: cost/shares, for shorts: proceeds/shares)
          CASE
            WHEN f.qty_bought >= f.qty_sold AND f.qty_bought > 0 THEN f.cost_usd / f.qty_bought
            WHEN f.qty_sold > f.qty_bought AND f.qty_sold > 0 THEN f.proceeds_usd / f.qty_sold
            ELSE 0
          END as p_entry_side,

          -- Anchor prices (NULL - filled later)
          NULL as p_anchor_4h_side,
          NULL as p_anchor_24h_side,
          NULL as p_anchor_72h_side,

          -- Resolution
          IF(r.payout_numerators IS NOT NULL AND r.payout_numerators != '', 1, 0) as is_resolved,

          -- Payout rate with [1,1] handling
          CASE
            WHEN r.payout_numerators = '[1,1]' THEN 0.5
            WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
            ELSE 0.0
          END as payout_rate,

          -- Outcome side
          IF(r.payout_numerators IS NOT NULL AND r.payout_numerators != '',
            IF(
              (r.payout_numerators = '[1,1]') OR
              (r.payout_numerators = '[0,1]' AND f.outcome_index = 1) OR
              (r.payout_numerators = '[1,0]' AND f.outcome_index = 0),
              1, 0
            ),
            NULL
          ) as outcome_side,

          -- PnL calculation using V1 formula
          CASE
            WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN
              round(
                f.net_cash +
                IF(f.net_tokens > 0, f.net_tokens * (
                  CASE
                    WHEN r.payout_numerators = '[1,1]' THEN 0.5
                    WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                    WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                    ELSE 0.0
                  END
                ), 0) -
                IF(f.net_tokens < 0, abs(f.net_tokens) * (
                  CASE
                    WHEN r.payout_numerators = '[1,1]' THEN 0.5
                    WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                    WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                    ELSE 0.0
                  END
                ), 0),
                2
              )
            ELSE
              round(f.net_cash + f.net_tokens * ifNull(mp.mark_price, 0), 2)
          END as pnl_usd,

          -- ROI: pnl / cost_basis
          -- cost_basis = cost_usd for LONGS, proceeds_usd for SHORTS
          -- Guard against divide-by-zero
          (
            CASE
              WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN
                -- Resolved position PnL
                f.net_cash +
                IF(f.net_tokens > 0, f.net_tokens * (
                  CASE
                    WHEN r.payout_numerators = '[1,1]' THEN 0.5
                    WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                    WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                    ELSE 0.0
                  END
                ), 0) -
                IF(f.net_tokens < 0, abs(f.net_tokens) * (
                  CASE
                    WHEN r.payout_numerators = '[1,1]' THEN 0.5
                    WHEN r.payout_numerators = '[0,1]' AND f.outcome_index = 1 THEN 1.0
                    WHEN r.payout_numerators = '[1,0]' AND f.outcome_index = 0 THEN 1.0
                    ELSE 0.0
                  END
                ), 0)
              ELSE
                -- Unrealized PnL
                f.net_cash + f.net_tokens * ifNull(mp.mark_price, 0)
            END
          ) / nullIf(
            -- Cost basis: for LONGS use cost_usd, for SHORTS use collateral
            -- NOTE: Use >= to handle fully closed positions as LONGs
            IF(f.qty_bought >= f.qty_sold,
              f.cost_usd,
              (f.qty_sold - f.qty_bought) - f.proceeds_usd  -- Collateral for shorts
            ),
            0  -- Return NULL if cost basis is 0
          ) as roi,

          -- Hold time
          dateDiff('minute', f.ts_open,
            coalesce(
              IF(f.qty_bought > 0 AND f.qty_sold >= f.qty_bought, f.ts_last_fill, NULL),
              r.resolved_at,
              now()
            )
          ) as hold_minutes,

          -- CLV (NULL - computed later)
          NULL as clv_4h,
          NULL as clv_24h,
          NULL as clv_72h,

          -- Brier score
          IF(r.payout_numerators IS NOT NULL AND r.payout_numerators != '' AND f.qty_bought > 0,
            pow(f.cost_usd / f.qty_bought - IF(
              (r.payout_numerators = '[1,1]') OR
              (r.payout_numerators = '[0,1]' AND f.outcome_index = 1) OR
              (r.payout_numerators = '[1,0]' AND f.outcome_index = 0),
              1, 0
            ), 2),
            NULL
          ) as brier_score,

          -- Fill metadata
          f.fills_count as fills_count,
          f.first_fill_id as first_fill_id,
          f.last_fill_id as last_fill_id,

          -- Timestamps
          now() as created_at,
          now() as updated_at

        FROM (
          -- Aggregate fills for this wallet prefix only
          SELECT
            wallet,
            condition_id,
            outcome_index,
            sum(tokens_delta) as net_tokens,
            sum(usdc_delta) as net_cash,
            sumIf(tokens_delta, tokens_delta > 0) as qty_bought,
            sumIf(abs(tokens_delta), tokens_delta < 0) as qty_sold,
            sumIf(abs(usdc_delta), usdc_delta < 0) as cost_usd,
            sumIf(usdc_delta, usdc_delta > 0) as proceeds_usd,
            min(event_time) as ts_open,
            max(event_time) as ts_last_fill,
            count() as fills_count,
            min(fill_id) as first_fill_id,
            max(fill_id) as last_fill_id
          FROM pm_canonical_fills_v4
          WHERE condition_id != ''
            AND source != 'negrisk'
            -- Note: Self-fill MAKERS were already excluded during canonical fills backfill
            -- Self-fill TAKERS should be included (they represent real economic exposure)
            AND startsWith(wallet, '${prefix}')
          GROUP BY wallet, condition_id, outcome_index
          HAVING qty_bought > 0 OR qty_sold > 0
        ) f
        LEFT JOIN pm_condition_resolutions r
          ON f.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_latest_mark_price_v1 mp
          ON lower(f.condition_id) = lower(mp.condition_id)
          AND f.outcome_index = mp.outcome_index
        LEFT JOIN pm_market_metadata m
          ON f.condition_id = m.condition_id
        LEFT JOIN wio_market_bundle_map b
          ON f.condition_id = b.condition_id
      `,
      clickhouse_settings: {
        max_execution_time: 600,  // 10 minutes per batch
        max_memory_usage: 8000000000,  // 8GB (server limit is ~10GB)
      }
    });

    // Get count for this batch
    const batchStats = await clickhouse.query({
      query: `SELECT count() as cnt FROM wio_positions_v2_new WHERE startsWith(wallet_id, '${prefix}')`,
      format: 'JSONEachRow'
    });
    const batchCount = Number((await batchStats.json() as any[])[0]?.cnt || 0);
    totalInserted += batchCount;

    const batchElapsed = Math.round((Date.now() - batchStart) / 1000);
    console.log(`    Done: ${batchCount.toLocaleString()} positions in ${batchElapsed}s`);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('');
  console.log(`All batches complete in ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
  console.log(`Total positions: ${totalInserted.toLocaleString()}`);
  console.log('');

  // Step 4: Verify new table stats
  console.log('Step 4: Verifying new table stats...');
  const newStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        uniqExact(wallet_id) as unique_wallets,
        uniqExact(condition_id) as unique_markets,
        countIf(is_resolved = 1) as resolved_positions,
        countIf(is_resolved = 0) as open_positions,
        round(sum(pnl_usd), 2) as total_pnl,
        countIf(pnl_usd > 0) as profitable,
        countIf(pnl_usd < 0) as unprofitable
      FROM wio_positions_v2_new
    `,
    format: 'JSONEachRow'
  });
  const newData = (await newStats.json() as any[])[0];

  console.log('New table stats:');
  console.log(`  Total positions: ${Number(newData.total_positions).toLocaleString()}`);
  console.log(`  Unique wallets: ${Number(newData.unique_wallets).toLocaleString()}`);
  console.log(`  Unique markets: ${Number(newData.unique_markets).toLocaleString()}`);
  console.log(`  Resolved: ${Number(newData.resolved_positions).toLocaleString()}`);
  console.log(`  Open: ${Number(newData.open_positions).toLocaleString()}`);
  console.log(`  Total PnL: $${Number(newData.total_pnl).toLocaleString()}`);
  console.log(`  Profitable: ${Number(newData.profitable).toLocaleString()}`);
  console.log(`  Unprofitable: ${Number(newData.unprofitable).toLocaleString()}`);
  console.log('');

  // Step 5: Validate against known wallets
  console.log('Step 5: Validating against known wallets...');
  const testWallets = [
    { wallet: '0x65f1ce507ec3f90d95e787354efbc40c5cd1c6c0', expected: 2.11, name: '[1,1] fix wallet' },
    { wallet: '0xb006ae685c5ab607e31f0db548f8d7f5cba5c243', expected: 27.19, name: 'synthetic wallet' },
  ];

  for (const test of testWallets) {
    const result = await clickhouse.query({
      query: `
        SELECT round(sum(pnl_usd), 2) as total_pnl
        FROM wio_positions_v2_new
        WHERE wallet_id = '${test.wallet}'
      `,
      format: 'JSONEachRow'
    });
    const row = (await result.json() as any[])[0];
    const pnl = Number(row?.total_pnl || 0);
    const diff = Math.abs(pnl - test.expected);
    const status = diff < 1 ? '✅' : diff < 10 ? '⚠️' : '❌';
    console.log(`  ${status} ${test.name}: $${pnl} (expected $${test.expected}, diff $${diff.toFixed(2)})`);
  }
  console.log('');

  // Step 6: Atomic swap
  console.log('Step 6: Performing atomic table swap...');

  // Drop backup if exists
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS wio_positions_v2_backup`
  });

  // Rename current to backup
  await clickhouse.command({
    query: `RENAME TABLE wio_positions_v2 TO wio_positions_v2_backup`
  });

  // Rename new to current
  await clickhouse.command({
    query: `RENAME TABLE wio_positions_v2_new TO wio_positions_v2`
  });

  console.log('Done. Swap complete!');
  console.log('');

  // Step 7: Final verification
  console.log('Step 7: Final verification...');
  const finalStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        uniqExact(wallet_id) as unique_wallets
      FROM wio_positions_v2
    `,
    format: 'JSONEachRow'
  });
  const final = (await finalStats.json() as any[])[0];
  console.log(`wio_positions_v2 now has ${Number(final.total_positions).toLocaleString()} positions from ${Number(final.unique_wallets).toLocaleString()} wallets`);
  console.log('');

  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('='.repeat(60));
  console.log(`REBUILD COMPLETE in ${Math.floor(totalElapsed / 60)}m ${totalElapsed % 60}s`);
  console.log('='.repeat(60));
  console.log('');
  console.log('Old table backed up to: wio_positions_v2_backup');
  console.log('To drop backup: DROP TABLE wio_positions_v2_backup');
  console.log('');

  process.exit(0);
}

rebuildWioPositions().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
