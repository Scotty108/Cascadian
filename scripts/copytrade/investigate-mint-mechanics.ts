/**
 * Investigate mint mechanics to understand token accounting
 *
 * Key insight: When Exchange routes a trade through minting:
 * 1. User wants to buy YES
 * 2. Exchange mints YES+NO pair (costs $1 from user's USDC)
 * 3. User gets the YES token
 * 4. Exchange auto-sells the NO token on CLOB
 *
 * BUT: Does the CLOB record the NO sell under user's wallet or Exchange's?
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== INVESTIGATING MINT MECHANICS ===\n');

  // Get per-token data to understand the pattern
  const q = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      token_id,
      sumIf(usdc, side = 'buy') as buy_usdc,
      sumIf(usdc, side = 'sell') as sell_usdc,
      sumIf(tokens, side = 'buy') as buy_tokens,
      sumIf(tokens, side = 'sell') as sell_tokens
    FROM deduped
    GROUP BY token_id
    HAVING buy_tokens > 0 OR sell_tokens > 0
    ORDER BY (buy_tokens + sell_tokens) DESC
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];

  let totalLong = 0;
  let totalShort = 0;
  let totalBuyUsdc = 0;
  let totalSellUsdc = 0;
  let longTokens = 0;
  let shortTokens = 0;

  for (const row of rows) {
    const buyU = parseFloat(row.buy_usdc);
    const sellU = parseFloat(row.sell_usdc);
    const buyT = parseFloat(row.buy_tokens);
    const sellT = parseFloat(row.sell_tokens);
    const net = buyT - sellT;

    totalBuyUsdc += buyU;
    totalSellUsdc += sellU;

    if (net > 0.01) {
      totalLong++;
      longTokens += net;
    } else if (net < -0.01) {
      totalShort++;
      shortTokens += Math.abs(net);
    }
  }
  console.log(`\nSummary:`);
  console.log(`  LONG positions: ${totalLong} tokens, ${longTokens.toFixed(2)} total`);
  console.log(`  SHORT positions: ${totalShort} tokens, ${shortTokens.toFixed(2)} total`);
  console.log(`  Net position: ${(longTokens - shortTokens).toFixed(2)} tokens`);
  console.log(`  Total buy USDC: $${totalBuyUsdc.toFixed(2)}`);
  console.log(`  Total sell USDC: $${totalSellUsdc.toFixed(2)}`);

  // Key insight: For binary markets, if we see LONG on one token and SHORT on another,
  // and they're the same market (YES/NO pair), then:
  // - LONG YES = bought YES + minted pairs (kept YES)
  // - SHORT NO = sold NO from mints

  // The cost structure would be:
  // - Buy LONG tokens on CLOB: $X
  // - Mint pairs: $Y for Y pairs
  // - Sell SHORT tokens: get $Z

  // Each mint: pay $1, get 1 YES + 1 NO
  // Net cost = $1 - sell_price_of_unwanted_side

  // For the wallet's short positions (sold without buying):
  // These tokens came from mints, sold at sell_usdc / sell_tokens price

  console.log('\n=== COST ANALYSIS ===');

  // For each SHORT position, the tokens came from mints
  // The mint cost is $1 per pair
  // The sell proceeds offset the cost

  // For each LONG position, the tokens came from:
  // 1. CLOB buys (visible in buy_usdc)
  // 2. Mints (keeping one side)

  // The tricky part: we can't distinguish CLOB buys from mint-keeps without ERC1155

  console.log('\nHypothesis: Each SHORT token came from a mint');
  console.log(`  Short tokens: ${shortTokens.toFixed(2)}`);
  console.log(`  Mint cost: $${shortTokens.toFixed(2)} (at $1 per pair)`);
  console.log(`  Sell proceeds: $${totalSellUsdc.toFixed(2)} (includes all sells)`);

  // Wait - the sells include BOTH:
  // 1. Sells from short positions (mint-and-sell)
  // 2. Sells from closing long positions

  // Let me calculate differently:
  // If short tokens = minted pairs:
  //   Mint cost = short_tokens * $1
  //   These mints ALSO gave us long tokens (the other side of each pair)
  //   So long tokens from mints = short_tokens

  const longFromMints = shortTokens; // Each mint gives 1 YES + 1 NO
  const longFromClob = Math.max(0, longTokens - longFromMints);

  console.log('\n=== REFINED ANALYSIS ===');
  console.log(`  Minted pairs: ${shortTokens.toFixed(2)} (one side sold = SHORT)`);
  console.log(`  From mints, KEPT: ${longFromMints.toFixed(2)} tokens`);
  console.log(`  From CLOB buys: ${longFromClob.toFixed(2)} tokens`);

  // Total spent:
  // 1. Mint cost: short_tokens * $1
  // 2. CLOB buy cost: buy_usdc (but this includes buying the other half of some positions)

  // Actually, the CLOB buy_usdc includes:
  // - Buying tokens to hold (longFromClob)
  // - Buying tokens that were later sold (closing positions)

  // This is getting circular. Let me try a different approach:
  // Use the Polymarket formula directly.

  const redemptions = 358.54;

  console.log('\n=== POLYMARKET-STYLE CALCULATION ===');

  // For each token position:
  // Realized P&L = sell_usdc - (buy_usdc * sell_tokens / buy_tokens) for closed portion
  // Unrealized P&L = (current_price - avg_buy_price) * held_tokens

  // But for SHORT positions (sell without buy), realized P&L = sell_usdc - $1 per token

  let realizedPnl = 0;
  let unrealizedValue = 0;

  for (const row of rows) {
    const buyU = parseFloat(row.buy_usdc);
    const sellU = parseFloat(row.sell_usdc);
    const buyT = parseFloat(row.buy_tokens);
    const sellT = parseFloat(row.sell_tokens);
    const net = buyT - sellT;

    if (net < -0.01) {
      // SHORT position: sold more than bought
      // The excess came from mints at $1 each
      const shortAmount = Math.abs(net);
      const mintCost = shortAmount * 1.0;
      const shortSellProceeds = sellU * (shortAmount / sellT); // Pro-rata
      realizedPnl += shortSellProceeds - mintCost;
    } else if (net < 0.01 && buyT > 0.01 && sellT > 0.01) {
      // FLAT: bought and sold roughly equal
      realizedPnl += sellU - buyU;
    } else if (net > 0.01) {
      // LONG position: bought more than sold
      // Realize P&L on sold portion
      if (sellT > 0.01) {
        const avgBuyPrice = buyU / buyT;
        const avgSellPrice = sellU / sellT;
        realizedPnl += sellT * (avgSellPrice - avgBuyPrice);
      }
      // Held tokens have unrealized value (need resolution price)
      // For now, assume $0 since markets are 15-min crypto (likely resolved)
      unrealizedValue += 0;
    }
  }

  console.log(`  Realized P&L from positions: $${realizedPnl.toFixed(2)}`);
  console.log(`  Unrealized value (assumed $0): $${unrealizedValue.toFixed(2)}`);
  console.log(`  Redemptions: $${redemptions.toFixed(2)}`);
  console.log(`  TOTAL P&L: $${(realizedPnl + unrealizedValue + redemptions).toFixed(2)}`);
  console.log(`  Ground truth: -$86.66`);
}

main().catch(console.error);
