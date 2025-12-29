#!/usr/bin/env tsx
/**
 * Analyze the worst wallet with -1 quadrillion shares
 *
 * Wallet: 0xc5d563a36a...
 * Position: -1,027,384,742,657,737 shares
 * Trades: 1,627,339 trades
 */

import * as dotenv from 'dotenv';
import { createClient } from '@clickhouse/client';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000
});

const WORST_WALLET = '0xc5d563a36ae78145c45a50134d48a1215220f80a';
const WORST_CONDITION = 'dd22472e552920b8438158ea7238bfadfa4f736aa4cee91a6b86c39ead110917';

async function analyze() {
  console.log('━━━ ANALYZING WORST WALLET ━━━');
  console.log(`Wallet: ${WORST_WALLET}`);
  console.log(`Condition: ${WORST_CONDITION}\n`);

  // Get side breakdown
  const sideQuery = `
    SELECT
      t.side,
      count(*) as trade_count,
      sum(t.token_amount) as total_shares,
      sum(t.usdc_amount) as total_usdc
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '${WORST_WALLET}'
      AND m.condition_id = '${WORST_CONDITION}'
      AND m.outcome_index = 0
    GROUP BY t.side
  `;

  const sides = await clickhouse.query({
    query: sideQuery,
    format: 'JSONEachRow'
  });
  const sidesData = await sides.json<any[]>();

  console.log('Trades by side:');
  console.table(sidesData.map(row => ({
    side: row.side,
    trades: parseInt(row.trade_count).toLocaleString(),
    shares: parseFloat(row.total_shares).toLocaleString(undefined, { maximumFractionDigits: 0 }),
    usdc: parseFloat(row.total_usdc).toLocaleString(undefined, { maximumFractionDigits: 0 })
  })));

  // Calculate correct balance
  const buyShares = parseFloat(sidesData.find(r => r.side === 'buy')?.total_shares || '0');
  const sellShares = parseFloat(sidesData.find(r => r.side === 'sell')?.total_shares || '0');

  console.log('\n━━━ POSITION CALCULATION ━━━\n');
  console.log(`BUY shares:  ${buyShares.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`SELL shares: ${sellShares.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`\nNet position (buy - sell): ${(buyShares - sellShares).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  // Check if this is a market maker
  console.log('\n━━━ MARKET MAKER ANALYSIS ━━━\n');

  const roleQuery = `
    SELECT
      t.role,
      t.side,
      count(*) as trade_count,
      sum(t.token_amount) as total_shares
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '${WORST_WALLET}'
      AND m.condition_id = '${WORST_CONDITION}'
      AND m.outcome_index = 0
    GROUP BY t.role, t.side
  `;

  const roles = await clickhouse.query({
    query: roleQuery,
    format: 'JSONEachRow'
  });
  const rolesData = await roles.json<any[]>();

  console.log('Trades by role and side:');
  console.table(rolesData.map(row => ({
    role: row.role,
    side: row.side,
    trades: parseInt(row.trade_count).toLocaleString(),
    shares: parseFloat(row.total_shares).toLocaleString(undefined, { maximumFractionDigits: 0 })
  })));

  // Check all positions for this wallet
  console.log('\n━━━ ALL POSITIONS FOR THIS WALLET ━━━\n');

  const allPositionsQuery = `
    SELECT
      m.condition_id,
      m.outcome_index,
      sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) as net_shares,
      count(*) as trade_count
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    WHERE t.trader_wallet = '${WORST_WALLET}'
    GROUP BY m.condition_id, m.outcome_index
    ORDER BY abs(net_shares) DESC
    LIMIT 10
  `;

  const allPos = await clickhouse.query({
    query: allPositionsQuery,
    format: 'JSONEachRow'
  });
  const allPosData = await allPos.json<any[]>();

  console.log('Top 10 positions by absolute size:');
  console.table(allPosData.map(row => ({
    condition_id: row.condition_id.substring(0, 16) + '...',
    outcome: row.outcome_index,
    net_shares: parseFloat(row.net_shares).toLocaleString(undefined, { maximumFractionDigits: 0 }),
    trades: parseInt(row.trade_count).toLocaleString()
  })));

  // Check how many positions are negative
  console.log('\n━━━ POSITION DISTRIBUTION ━━━\n');

  const distQuery = `
    WITH positions AS (
      SELECT
        sum(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END) as net_shares
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE t.trader_wallet = '${WORST_WALLET}'
      GROUP BY m.condition_id, m.outcome_index
    )
    SELECT
      countIf(net_shares > 0.01) as long_positions,
      countIf(net_shares < -0.01) as short_positions,
      countIf(abs(net_shares) <= 0.01) as flat_positions,
      sum(net_shares) as total_net_shares
    FROM positions
  `;

  const dist = await clickhouse.query({
    query: distQuery,
    format: 'JSONEachRow'
  });
  const distData = await dist.json<any[]>();

  console.table(distData);
}

analyze()
  .then(() => {
    console.log('\n✅ Analysis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  });
