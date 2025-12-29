/**
 * Check resolution-based P&L calculation
 *
 * This script checks if we can properly calculate P&L using resolution prices
 * for positions that have been resolved (market went to 0 or 100)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== CHECKING RESOLUTION-BASED P&L ===');
  console.log(`Wallet: ${WALLET}`);

  // Check if we have resolution prices for this wallet's tokens
  const q1 = `
    WITH wallet_tokens AS (
      SELECT DISTINCT token_id, m.condition_id
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE trader_wallet = '${WALLET}' AND t.is_deleted = 0
    )
    SELECT
      count() as total_tokens,
      countIf(r.condition_id IS NOT NULL AND r.condition_id != '') as has_resolution,
      countIf(r.resolved_price IS NOT NULL) as has_price
    FROM wallet_tokens wt
    LEFT JOIN vw_pm_resolution_prices r ON wt.condition_id = r.condition_id
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const rows1 = (await r1.json()) as any[];
  console.log('\nResolution coverage:', rows1[0]);

  // Check pm_resolution_prices_v2 schema
  const schemaQ = `DESCRIBE TABLE vw_pm_resolution_prices`;
  const schemaR = await clickhouse.query({ query: schemaQ, format: 'JSONEachRow' });
  const schema = (await schemaR.json()) as any[];
  console.log('\nResolution schema:', schema.map(s => s.name + ': ' + s.type).join(', '));

  // Sample resolution data
  const sampleQ = `
    SELECT * FROM vw_pm_resolution_prices LIMIT 3
  `;
  const sampleR = await clickhouse.query({ query: sampleQ, format: 'JSONEachRow' });
  const samples = (await sampleR.json()) as any[];
  console.log('\nSample resolutions:', JSON.stringify(samples, null, 2));

  // Calculate P&L using resolution prices
  const pnlQ = `
    WITH trades AS (
      SELECT
        t.token_id,
        m.condition_id,
        m.outcome_index,
        t.side,
        sum(t.usdc_amount) / 1e6 as usdc,
        sum(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE trader_wallet = '${WALLET}' AND t.is_deleted = 0
      GROUP BY t.token_id, m.condition_id, m.outcome_index, t.side
    ),
    positions AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(usdc, side = 'buy') as buy_usdc,
        sumIf(usdc, side = 'sell') as sell_usdc,
        sumIf(tokens, side = 'buy') as buy_tokens,
        sumIf(tokens, side = 'sell') as sell_tokens,
        sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as net_tokens
      FROM trades
      GROUP BY condition_id, outcome_index
    )
    SELECT
      p.condition_id,
      p.outcome_index,
      p.buy_usdc,
      p.sell_usdc,
      p.net_tokens,
      r.resolved_price,
      CASE
        WHEN p.net_tokens = 0 THEN p.sell_usdc - p.buy_usdc
        WHEN r.resolved_price IS NOT NULL THEN
          (p.sell_usdc - p.buy_usdc) + (p.net_tokens * r.resolved_price)
        ELSE NULL
      END as pnl
    FROM positions p
    LEFT JOIN vw_pm_resolution_prices r
      ON p.condition_id = r.condition_id
      AND p.outcome_index = r.outcome_index
    WHERE p.condition_id IS NOT NULL
    LIMIT 20
  `;

  const pnlR = await clickhouse.query({ query: pnlQ, format: 'JSONEachRow' });
  const pnls = (await pnlR.json()) as any[];
  console.log('\nPosition-level P&L:');
  let totalPnl = 0;
  let countWithPnl = 0;
  for (const p of pnls) {
    const pnlVal = parseFloat(p.pnl);
    if (!isNaN(pnlVal)) {
      totalPnl += pnlVal;
      countWithPnl++;
    }
    console.log(`  ${p.condition_id?.slice(0,8) || 'NULL'}... idx=${p.outcome_index} net=${parseFloat(p.net_tokens || 0).toFixed(2)} res=${p.resolved_price} pnl=${p.pnl}`);
  }
  console.log(`\nTotal P&L from ${countWithPnl} positions: $${totalPnl.toFixed(2)}`);

  // Now check the UNMAPPED positions (where condition_id is NULL)
  console.log('\n=== UNMAPPED POSITIONS (15-min crypto) ===');
  const unmappedQ = `
    SELECT
      token_id,
      side,
      sum(usdc_amount) / 1e6 as usdc,
      sum(token_amount) / 1e6 as tokens
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE trader_wallet = '${WALLET}'
      AND t.is_deleted = 0
      AND (m.condition_id IS NULL OR m.condition_id = '')
    GROUP BY token_id, side
    ORDER BY tokens DESC
    LIMIT 20
  `;

  const unmappedR = await clickhouse.query({ query: unmappedQ, format: 'JSONEachRow' });
  const unmapped = (await unmappedR.json()) as any[];

  let unmappedBuys = 0, unmappedSells = 0;
  let unmappedBuyTokens = 0, unmappedSellTokens = 0;
  for (const u of unmapped) {
    if (u.side === 'buy') {
      unmappedBuys += parseFloat(u.usdc);
      unmappedBuyTokens += parseFloat(u.tokens);
    } else {
      unmappedSells += parseFloat(u.usdc);
      unmappedSellTokens += parseFloat(u.tokens);
    }
  }

  console.log(`Unmapped buys: $${unmappedBuys.toFixed(2)} (${unmappedBuyTokens.toFixed(2)} tokens)`);
  console.log(`Unmapped sells: $${unmappedSells.toFixed(2)} (${unmappedSellTokens.toFixed(2)} tokens)`);
  console.log(`Unmapped token deficit: ${(unmappedSellTokens - unmappedBuyTokens).toFixed(2)}`);
  console.log(`Unmapped cash flow: $${(unmappedSells - unmappedBuys).toFixed(2)}`);

  // Check CTF redemptions
  console.log('\n=== CTF REDEMPTIONS ===');
  const ctfQ = `
    SELECT
      event_type,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_usdc
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND is_deleted = 0
    GROUP BY event_type
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctf = (await ctfR.json()) as any[];
  for (const c of ctf) {
    console.log(`  ${c.event_type}: $${parseFloat(c.total_usdc).toFixed(2)}`);
  }

  // Final reconciliation
  console.log('\n=== RECONCILIATION ===');
  console.log('Ground truth P&L: -$86.66');
  console.log(`Mapped positions P&L: $${totalPnl.toFixed(2)}`);
  console.log(`Unmapped cash flow: $${(unmappedSells - unmappedBuys).toFixed(2)}`);
  console.log(`Gap (unmapped deficit * ~$1/token): $${(unmappedSellTokens - unmappedBuyTokens).toFixed(2)}`);
}

main().catch(console.error);
