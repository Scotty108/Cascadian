#!/usr/bin/env npx tsx
/**
 * Test sell clamp fix on the two failing wallets
 *
 * Verifies the fix before rebuilding full table
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';
const TRADER_EVENTS_TABLE = 'pm_trader_events_v2';
const RESOLUTIONS_TABLE = 'pm_condition_resolutions';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

interface RawEvent {
  event_id: string;
  wallet: string;
  condition_id: string;
  outcome_index: number;
  side: string;
  usdc_amount: string;
  token_amount: string;
}

interface Resolution {
  condition_id: string;
  payout_0: number;
  payout_1: number;
}

// Test wallets with expected UI values
// NOTE: Addresses corrected 2025-12-13 - original addresses were truncated incorrectly
const TEST_WALLETS = [
  { wallet: '0x8605e2ae9631282625e5e00e2eedc0f20f16750f', ui_pnl: -158049.95, name: 'GOTTAPAYRENT' },
  { wallet: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', ui_pnl: 433602.97, name: 'Latina' },
  // Also include a validation wallet to make sure we didn't break it
  { wallet: '0x132b505596fadb6971bbb0fbded509421baf3a16', ui_pnl: 2068.50, name: 'Validation' },
];

async function computeWalletPnL(wallet: string, resolutions: Map<string, Resolution>): Promise<{
  realized_profit: number;
  sell_profit: number;
  redemption_profit: number;
  unredeemed_loss: number;
  overflow_sells: number;
  n_positions: number;
}> {
  // Get deduped events from SQL
  const eventsQ = await clickhouse.query({
    query: `
      SELECT
        d.event_id,
        d.wallet,
        m.condition_id,
        m.outcome_index,
        d.side,
        d.usdc_amount,
        d.token_amount
      FROM (
        SELECT
          event_id,
          lower(any(trader_wallet)) as wallet,
          any(trade_time) as trade_time,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount
        FROM ${TRADER_EVENTS_TABLE}
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        GROUP BY event_id
      ) d
      JOIN ${TOKEN_MAP_TABLE} m ON d.token_id = m.token_id_dec
      ORDER BY d.wallet, d.trade_time
    `,
    format: 'JSONEachRow'
  });
  const events = await eventsQ.json() as RawEvent[];

  // Build positions
  const positions = new Map<string, {
    condition_id: string;
    outcome_index: number;
    buy_usdc: number;
    sell_usdc: number;
    buy_tokens: number;
    sell_tokens: number;
  }>();

  for (const e of events) {
    const key = `${e.condition_id}_${e.outcome_index}`;
    if (!positions.has(key)) {
      positions.set(key, {
        condition_id: e.condition_id,
        outcome_index: e.outcome_index,
        buy_usdc: 0,
        sell_usdc: 0,
        buy_tokens: 0,
        sell_tokens: 0,
      });
    }
    const pos = positions.get(key)!;
    const usdc = Number(e.usdc_amount) / 1e6;
    const tokens = Number(e.token_amount) / 1e6;

    if (e.side === 'buy') {
      pos.buy_usdc += usdc;
      pos.buy_tokens += tokens;
    } else {
      pos.sell_usdc += usdc;
      pos.sell_tokens += tokens;
    }
  }

  // Calculate profit with sell clamp fix
  let sellProfit = 0;
  let redemptionProfit = 0;
  let unredeemedLoss = 0;
  let overflowSells = 0;

  for (const [, pos] of positions) {
    const netTokens = pos.buy_tokens - pos.sell_tokens;
    const avgBuyPrice = pos.buy_tokens > 0 ? pos.buy_usdc / pos.buy_tokens : 0;

    // Skip pure synthetic positions
    if (pos.buy_tokens === 0 && pos.sell_tokens > 0) {
      continue;
    }

    // SELL CLAMP FIX: Only calculate profit on tokens we actually owned
    if (pos.sell_tokens > 0 && pos.buy_tokens > 0) {
      const ownedTokensSold = Math.min(pos.buy_tokens, pos.sell_tokens);
      const proportionOwned = ownedTokensSold / pos.sell_tokens;
      const ownedProceeds = pos.sell_usdc * proportionOwned;
      const ownedCostBasis = ownedTokensSold * avgBuyPrice;
      sellProfit += ownedProceeds - ownedCostBasis;

      // Track overflow (synthetic sells)
      const overflow = pos.sell_tokens - ownedTokensSold;
      if (overflow > 0) {
        overflowSells += overflow;
      }
    }

    // Resolution profit/loss
    if (netTokens > 0) {
      const resolution = resolutions.get(pos.condition_id.toLowerCase());
      if (resolution) {
        const payoutKey = pos.outcome_index === 0 ? 'payout_0' : 'payout_1';
        const payout = resolution[payoutKey];
        const costBasis = netTokens * avgBuyPrice;

        if (payout > 0) {
          redemptionProfit += netTokens * payout - costBasis;
        } else {
          unredeemedLoss -= costBasis;
        }
      }
    }
  }

  return {
    realized_profit: sellProfit + redemptionProfit + unredeemedLoss,
    sell_profit: sellProfit,
    redemption_profit: redemptionProfit,
    unredeemed_loss: unredeemedLoss,
    overflow_sells: overflowSells,
    n_positions: positions.size,
  };
}

async function main() {
  console.log('TEST SELL CLAMP FIX');
  console.log('='.repeat(80));

  // Load resolutions
  console.log('Loading resolutions...');
  const resolutionsQ = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        toUInt8(JSONExtractInt(payout_numerators, 1) > 0) as payout_0,
        toUInt8(JSONExtractInt(payout_numerators, 2) > 0) as payout_1
      FROM ${RESOLUTIONS_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const resolutions = new Map<string, Resolution>();
  for (const r of await resolutionsQ.json() as Resolution[]) {
    resolutions.set(r.condition_id, r);
  }
  console.log(`  Loaded ${resolutions.size} resolutions\n`);

  // Test each wallet
  console.log('RESULTS:');
  console.log('-'.repeat(100));
  console.log('Wallet                                     | UI PnL       | Our PnL      | Delta      | Match');
  console.log('-'.repeat(100));

  for (const test of TEST_WALLETS) {
    const result = await computeWalletPnL(test.wallet, resolutions);
    const delta = result.realized_profit - test.ui_pnl;
    const match = Math.abs(delta) < 1000 ? '✅' : (Math.abs(delta) < 10000 ? '⚠️' : '❌');

    console.log(
      `${test.wallet.slice(0, 42)} | ` +
      `$${test.ui_pnl.toLocaleString().padStart(10)} | ` +
      `$${result.realized_profit.toFixed(2).padStart(10)} | ` +
      `$${delta.toFixed(2).padStart(9)} | ${match}`
    );

    // Show breakdown for failing wallets
    if (Math.abs(delta) >= 1000) {
      console.log(`  Components: sell=$${result.sell_profit.toFixed(2)}, redemption=$${result.redemption_profit.toFixed(2)}, loss=$${result.unredeemed_loss.toFixed(2)}`);
      console.log(`  Overflow (synthetic) sells: ${result.overflow_sells.toFixed(2)} tokens`);
      console.log(`  Positions: ${result.n_positions}`);
    }
  }
  console.log('-'.repeat(100));

  await clickhouse.close();
}

main().catch(console.error);
