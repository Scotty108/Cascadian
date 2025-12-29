/**
 * Build Trusted Cohort - Simple Stepped Approach
 *
 * Step 1: Create inventory-conserving wallet list
 * Step 2: Add activity metrics
 * Step 3: Compute PnL using V11_POLY (validated engine)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const MAX_NEGATIVE_INVENTORY = -1000;
const MIN_TRADES = 20;
const MIN_VOLUME = 500;

async function main() {
  console.log('='.repeat(80));
  console.log('BUILD TRUSTED COHORT - SIMPLE APPROACH');
  console.log('='.repeat(80));

  // Step 1: Count conserving wallets with activity
  console.log('\n=== Step 1: Count Conserving Wallets ===\n');

  const countQuery = `
    SELECT count() as total
    FROM (
      SELECT wallet_address
      FROM (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(token_delta) as sum_tokens
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
      )
      GROUP BY wallet_address
      HAVING min(sum_tokens) >= ${MAX_NEGATIVE_INVENTORY}
    )
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const count = ((await countResult.json()) as any[])[0]?.total || 0;
  console.log(`Inventory-conserving wallets: ${count.toLocaleString()}`);

  // Step 2: Get conserving wallets with activity metrics
  console.log('\n=== Step 2: Get Conserving Wallets with Activity ===\n');

  const activityQuery = `
    SELECT
      conserving.wallet_address,
      activity.trade_count,
      activity.total_volume,
      activity.markets_traded,
      activity.buy_count,
      activity.sell_count
    FROM (
      -- Conserving wallets
      SELECT wallet_address
      FROM (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(token_delta) as sum_tokens
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
      )
      GROUP BY wallet_address
      HAVING min(sum_tokens) >= ${MAX_NEGATIVE_INVENTORY}
    ) conserving
    INNER JOIN (
      -- Activity metrics
      SELECT
        wallet_address,
        count() as trade_count,
        sum(abs(usdc_delta)) as total_volume,
        countDistinct(condition_id) as markets_traded,
        countIf(token_delta > 0) as buy_count,
        countIf(token_delta < 0) as sell_count
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
        AND condition_id IS NOT NULL
      GROUP BY wallet_address
      HAVING trade_count >= ${MIN_TRADES} AND total_volume >= ${MIN_VOLUME}
    ) activity ON conserving.wallet_address = activity.wallet_address
    ORDER BY activity.total_volume DESC
    LIMIT 50
  `;

  console.log('Querying top 50 conserving wallets by volume...');
  const activityResult = await clickhouse.query({
    query: activityQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const wallets = await activityResult.json() as any[];

  console.log(`\nFound ${wallets.length} wallets\n`);
  console.log('wallet | trades | buys | sells | volume | markets');
  console.log('-'.repeat(90));

  for (const w of wallets.slice(0, 25)) {
    console.log(
      `${w.wallet_address.slice(0, 10)}... | ${w.trade_count.toString().padStart(6)} | ${w.buy_count.toString().padStart(5)} | ${w.sell_count.toString().padStart(5)} | $${Number(w.total_volume).toLocaleString().padStart(12)} | ${w.markets_traded.toString().padStart(4)}`
    );
  }

  // Step 3: Compute PnL for top wallets using market-level aggregation
  console.log('\n\n=== Step 3: Compute Realized PnL (Market-Level) ===\n');

  // For each wallet, compute PnL per resolved market
  const pnlQuery = `
    SELECT
      wallet_address,
      -- Sum realized PnL across all resolved markets
      sum(market_pnl) as realized_pnl,
      -- Count resolved markets
      count() as resolved_markets,
      -- Count wins (positive PnL)
      countIf(market_pnl > 0) as wins,
      -- Win rate
      if(count() > 0, countIf(market_pnl > 0) / count(), 0) as win_rate
    FROM (
      SELECT
        l.wallet_address,
        l.condition_id,
        -- Market-level PnL = cash_flow + final_position * resolution_price
        sum(l.usdc_delta) + sum(l.token_delta) * any(r.resolved_price) as market_pnl
      FROM pm_unified_ledger_v9_clob_tbl l
      INNER JOIN vw_pm_resolution_prices r
        ON l.condition_id = r.condition_id AND l.outcome_index = r.outcome_index
      WHERE l.source_type = 'CLOB'
        AND l.condition_id IS NOT NULL
        AND l.wallet_address IN (${wallets.slice(0, 20).map(w => `'${w.wallet_address}'`).join(',')})
      GROUP BY l.wallet_address, l.condition_id
    )
    GROUP BY wallet_address
    ORDER BY realized_pnl DESC
  `;

  const pnlResult = await clickhouse.query({
    query: pnlQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 }
  });
  const pnlData = await pnlResult.json() as any[];

  console.log('Realized PnL for top 20 wallets (resolved markets only):');
  console.log('wallet | realized_pnl | resolved_markets | wins | win_rate');
  console.log('-'.repeat(80));

  for (const p of pnlData) {
    const pnlStr = Number(p.realized_pnl) >= 0
      ? `+$${Number(p.realized_pnl).toLocaleString()}`
      : `-$${Math.abs(Number(p.realized_pnl)).toLocaleString()}`;
    console.log(
      `${p.wallet_address.slice(0, 10)}... | ${pnlStr.padStart(15)} | ${p.resolved_markets.toString().padStart(10)} | ${p.wins.toString().padStart(4)} | ${(Number(p.win_rate) * 100).toFixed(1)}%`
    );
  }

  // Step 4: Summary stats
  console.log('\n\n=== Summary ===\n');

  const summaryQuery = `
    SELECT
      count() as total_conserving_active
    FROM (
      SELECT wallet_address
      FROM (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(token_delta) as sum_tokens
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
      )
      GROUP BY wallet_address
      HAVING min(sum_tokens) >= ${MAX_NEGATIVE_INVENTORY}
    ) conserving
    INNER JOIN (
      SELECT wallet_address
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
      GROUP BY wallet_address
      HAVING count() >= ${MIN_TRADES} AND sum(abs(usdc_delta)) >= ${MIN_VOLUME}
    ) active ON conserving.wallet_address = active.wallet_address
  `;

  const summaryResult = await clickhouse.query({
    query: summaryQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 300 }
  });
  const summary = ((await summaryResult.json()) as any[])[0];

  console.log(`Total conserving wallets with ${MIN_TRADES}+ trades and $${MIN_VOLUME}+ volume: ${summary?.total_conserving_active?.toLocaleString() || 'N/A'}`);
  console.log(`\nThis is your trusted cohort for copy-trade ranking.`);
}

main().catch(console.error);
