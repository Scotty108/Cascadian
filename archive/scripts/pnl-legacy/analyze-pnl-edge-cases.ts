#!/usr/bin/env node
import { config } from 'dotenv';
import { clickhouse } from '../lib/clickhouse/client.js';

config({ path: '.env.local' });

const TEST_WALLETS = [
  '0xe29aaa4696b824ae186075a4a1220262f2f7612f',
  '0xd38ad20037839959d89165cf448568d584b28d26',
  '0x614ef98a8be021de3a974942b2fb98794ff34f1b',
  '0x5e0220909135c88382a2128e1e8ef1278567817e',
];

async function checkEdgeCases(wallet: string) {
  console.log(`\n🔍 Edge Case Analysis for ${wallet}`);
  console.log('='.repeat(80));

  // 1. Check for markets with zero final shares but non-zero PnL
  const zeroSharesPnl = await clickhouse.query({
    query: `
      WITH per_outcome AS (
          SELECT
              m.condition_id,
              m.outcome_index,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN -(t.usdc_amount / 1000000)
                       ELSE +(t.usdc_amount / 1000000) END) as cash_delta,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN +(t.token_amount / 1000000)
                       ELSE -(t.token_amount / 1000000) END) as final_shares
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          WHERE t.trader_wallet = '${wallet}'
          GROUP BY m.condition_id, m.outcome_index
      ),
      with_resolution AS (
          SELECT
              p.*,
              CASE
                  WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 0 THEN 0.0
                  WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 1 THEN 1.0
                  WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 0 THEN 1.0
                  WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 1 THEN 0.0
                  ELSE 0.0
              END as resolved_price
          FROM per_outcome p
          INNER JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
      ),
      per_market AS (
          SELECT
              condition_id,
              sum(abs(final_shares)) as total_abs_shares,
              round(sum(cash_delta + final_shares * resolved_price), 2) as market_pnl
          FROM with_resolution
          GROUP BY condition_id
      )
      SELECT
          count(*) as count_zero_shares_with_pnl
      FROM per_market
      WHERE total_abs_shares < 0.01 AND abs(market_pnl) > 0.01
    `,
    format: 'JSONEachRow'
  });
  const zeroSharesResult = await zeroSharesPnl.json<{ count_zero_shares_with_pnl: number }>();
  console.log(`\n📊 Markets with ~0 final shares but non-zero PnL: ${zeroSharesResult[0]?.count_zero_shares_with_pnl || 0}`);

  // 2. Check for markets with unresolved data
  const unresolvedCheck = await clickhouse.query({
    query: `
      WITH per_outcome AS (
          SELECT
              m.condition_id,
              count(*) as trades
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          WHERE t.trader_wallet = '${wallet}'
          GROUP BY m.condition_id
      )
      SELECT
          p.condition_id,
          p.trades,
          r.condition_id as has_resolution
      FROM per_outcome p
      LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
      WHERE r.condition_id IS NULL
      ORDER BY p.trades DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const unresolvedResult = await unresolvedCheck.json<{ condition_id: string; trades: number; has_resolution: string | null }>();
  console.log(`\n📊 Unresolved markets (wallet has trades but no resolution):`);
  if (unresolvedResult.length === 0) {
    console.log('   ✅ All markets with trades have resolutions');
  } else {
    unresolvedResult.forEach(r => {
      console.log(`   - ${r.condition_id.substring(0, 12)}... (${r.trades} trades)`);
    });
  }

  // 3. Check for unusual resolution patterns
  const unusualResolutions = await clickhouse.query({
    query: `
      WITH per_outcome AS (
          SELECT
              m.condition_id,
              m.outcome_index,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN -(t.usdc_amount / 1000000)
                       ELSE +(t.usdc_amount / 1000000) END) as cash_delta,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN +(t.token_amount / 1000000)
                       ELSE -(t.token_amount / 1000000) END) as final_shares
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          WHERE t.trader_wallet = '${wallet}'
          GROUP BY m.condition_id, m.outcome_index
      )
      SELECT
          r.condition_id,
          r.payout_numerators,
          count(*) as outcome_count
      FROM per_outcome p
      INNER JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
      WHERE r.payout_numerators NOT LIKE '[0,%'
        AND r.payout_numerators NOT LIKE '[1,%'
      GROUP BY r.condition_id, r.payout_numerators
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const unusualResult = await unusualResolutions.json<{ condition_id: string; payout_numerators: string; outcome_count: number }>();
  console.log(`\n📊 Unusual resolution patterns (not [0,1] or [1,0]):`);
  if (unusualResult.length === 0) {
    console.log('   ✅ All resolutions follow standard binary pattern');
  } else {
    unusualResult.forEach(r => {
      console.log(`   - ${r.condition_id.substring(0, 12)}... payout: ${r.payout_numerators}`);
    });
  }

  // 4. Check for extreme leverage (high PnL vs volume)
  const extremePnl = await clickhouse.query({
    query: `
      WITH per_outcome AS (
          SELECT
              m.condition_id,
              m.outcome_index,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN -(t.usdc_amount / 1000000)
                       ELSE +(t.usdc_amount / 1000000) END) as cash_delta,
              sum(CASE WHEN lower(t.side) = 'buy'
                       THEN +(t.token_amount / 1000000)
                       ELSE -(t.token_amount / 1000000) END) as final_shares,
              sum(abs(t.usdc_amount / 1000000)) as total_volume
          FROM pm_trader_events_v2 t
          JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
          WHERE t.trader_wallet = '${wallet}'
          GROUP BY m.condition_id, m.outcome_index
      ),
      with_resolution AS (
          SELECT
              p.condition_id,
              p.cash_delta,
              p.final_shares,
              p.total_volume,
              CASE
                  WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 0 THEN 0.0
                  WHEN r.payout_numerators LIKE '[0,%' AND p.outcome_index = 1 THEN 1.0
                  WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 0 THEN 1.0
                  WHEN r.payout_numerators LIKE '[1,%' AND p.outcome_index = 1 THEN 0.0
                  ELSE 0.0
              END as resolved_price
          FROM per_outcome p
          INNER JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
      ),
      per_market AS (
          SELECT
              condition_id,
              sum(total_volume) as market_volume,
              round(sum(cash_delta + final_shares * resolved_price), 2) as market_pnl
          FROM with_resolution
          GROUP BY condition_id
      )
      SELECT
          condition_id,
          market_volume,
          market_pnl,
          round(abs(market_pnl) / GREATEST(market_volume, 1), 2) as pnl_to_volume_ratio
      FROM per_market
      WHERE market_volume > 1000
      ORDER BY pnl_to_volume_ratio DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const extremeResult = await extremePnl.json<{
    condition_id: string;
    market_volume: number;
    market_pnl: number;
    pnl_to_volume_ratio: number;
  }>();
  console.log(`\n📊 Markets with highest PnL-to-Volume ratio (efficiency):`);
  extremeResult.forEach(r => {
    console.log(`   - ${r.condition_id.substring(0, 12)}... | PnL: $${r.market_pnl.toLocaleString()} | Volume: $${r.market_volume.toLocaleString()} | Ratio: ${r.pnl_to_volume_ratio}x`);
  });

  // 5. Check for data consistency issues
  const dataConsistency = await clickhouse.query({
    query: `
      SELECT
          count(DISTINCT t.trader_wallet) as unique_wallets,
          count(*) as total_events,
          count(DISTINCT t.token_id) as unique_tokens,
          count(DISTINCT m.condition_id) as unique_conditions
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE t.trader_wallet = '${wallet}'
    `,
    format: 'JSONEachRow'
  });
  const consistencyResult = await dataConsistency.json<{
    unique_wallets: number;
    total_events: number;
    unique_tokens: number;
    unique_conditions: number;
  }>();
  console.log(`\n📊 Data consistency check:`);
  console.log(`   - Total trade events: ${consistencyResult[0]?.total_events || 0}`);
  console.log(`   - Unique tokens traded: ${consistencyResult[0]?.unique_tokens || 0}`);
  console.log(`   - Unique markets: ${consistencyResult[0]?.unique_conditions || 0}`);
}

async function main() {
  console.log('🔬 PnL Edge Case Analysis\n');
  console.log('Checking for:');
  console.log('1. Markets with ~0 final shares but non-zero PnL (closed positions)');
  console.log('2. Unresolved markets (trades without resolution data)');
  console.log('3. Unusual resolution patterns (not standard binary [0,1] or [1,0])');
  console.log('4. Extreme PnL-to-Volume ratios (high efficiency trades)');
  console.log('5. Data consistency issues\n');

  for (const wallet of TEST_WALLETS) {
    await checkEdgeCases(wallet);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Edge case analysis complete\n');
}

main().catch(console.error);
