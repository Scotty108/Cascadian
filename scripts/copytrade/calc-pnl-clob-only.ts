/**
 * Calculate P&L for CLOB-only wallet (no ERC1155 data)
 *
 * Key insight: ERC1155 indexing stopped 2025-11-11, but wallet traded 2025-12-22
 * We must derive token sources from CLOB patterns alone
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const REDEMPTIONS = 358.54; // From CTF PayoutRedemption events

async function main() {
  console.log('=== P&L CALCULATION FOR CLOB-ONLY WALLET ===');
  console.log('(No ERC1155 data available - indexing stopped 2025-11-11)\n');

  // Get aggregate CLOB data
  const q = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as total_buys,
      sum(if(side = 'sell', usdc, 0)) as total_sells,
      sum(if(side = 'buy', tokens, 0)) as tokens_bought,
      sum(if(side = 'sell', tokens, 0)) as tokens_sold
    FROM deduped
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];
  const data = rows[0];

  const buys = parseFloat(data.total_buys);
  const sells = parseFloat(data.total_sells);
  const tokensBought = parseFloat(data.tokens_bought);
  const tokensSold = parseFloat(data.tokens_sold);

  console.log('CLOB Activity:');
  console.log(`  Buys:  $${buys.toFixed(2)} (${tokensBought.toFixed(2)} tokens)`);
  console.log(`  Sells: $${sells.toFixed(2)} (${tokensSold.toFixed(2)} tokens)`);
  console.log(`  Cash flow (sells - buys): $${(sells - buys).toFixed(2)}`);
  console.log(`  Token imbalance (sold - bought): ${(tokensSold - tokensBought).toFixed(2)}`);

  // The token imbalance represents tokens sold that came from MINTS
  // For 15-min markets: Exchange mints YES+NO pair, sells unwanted side on CLOB
  const imbalance = tokensSold - tokensBought;
  const mintedTokens = Math.max(0, imbalance);

  console.log('\n=== P&L FORMULAS ===');

  // Formula 1: Simple cash flow (WRONG for mint-using wallets)
  const pnl1 = sells - buys + REDEMPTIONS;
  console.log(`\n1. Simple: sells - buys + redemptions = $${pnl1.toFixed(2)} ❌`);

  // Formula 2: Full cost accounting
  // - Each minted token pair costs $1 total
  // - User sold one side on CLOB (recorded in sells)
  // - User kept the other side (held tokens)
  // Total spent = buys + (minted pairs * $1)
  // But minted pairs = imbalance (each mint creates 1 YES + 1 NO, user sold 1)

  const mintCost = mintedTokens * 1.0; // $1 per minted pair
  const totalSpent = buys + mintCost;
  const totalReceived = sells + REDEMPTIONS;
  const pnlBeforeHeld = totalReceived - totalSpent;

  console.log(`\n2. Full cost accounting:`);
  console.log(`   Buys from CLOB: $${buys.toFixed(2)}`);
  console.log(`   Minted tokens: ${mintedTokens.toFixed(2)} @ $1/pair = $${mintCost.toFixed(2)}`);
  console.log(`   Total spent: $${totalSpent.toFixed(2)}`);
  console.log(`   Sells + Redemptions: $${totalReceived.toFixed(2)}`);
  console.log(`   P&L (before held tokens): $${pnlBeforeHeld.toFixed(2)}`);

  // For ground truth match
  const groundTruth = -86.66;
  const impliedHeldValue = groundTruth - pnlBeforeHeld;
  const netHeld = tokensBought - tokensSold; // Negative = short, positive = long

  console.log(`\n=== RECONCILIATION ===`);
  console.log(`   Ground truth: $${groundTruth.toFixed(2)}`);
  console.log(`   Calculated (before held): $${pnlBeforeHeld.toFixed(2)}`);
  console.log(`   Gap (held token value): $${impliedHeldValue.toFixed(2)}`);
  console.log(`   Net tokens held: ${netHeld.toFixed(2)}`);

  if (netHeld !== 0) {
    const pricePerHeld = impliedHeldValue / netHeld;
    console.log(`   Implied price per held token: $${pricePerHeld.toFixed(4)}`);
  }

  // The key insight: netHeld is negative (-1125), meaning wallet is SHORT
  // Short position value at resolution depends on the winning side
  // If loser: profit = original_sell_price per token
  // If winner: loss = $1 - original_sell_price per token

  console.log('\n=== INTERPRETATION ===');
  if (netHeld < 0) {
    console.log(`   Net position: SHORT ${Math.abs(netHeld).toFixed(2)} tokens`);
    console.log(`   These tokens were sold but not bought (came from mints)`);
    console.log(`   At resolution:`);
    console.log(`     - If tokens resolve to $0: keep full sell proceeds`);
    console.log(`     - If tokens resolve to $1: owe $1 per token`);
  } else {
    console.log(`   Net position: LONG ${netHeld.toFixed(2)} tokens`);
    console.log(`   Current value depends on resolution/market price`);
  }
}

main().catch(console.error);
