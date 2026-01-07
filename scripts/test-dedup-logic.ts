import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xf918977ef9d3f101385eda508621d5f835fa9052';

async function testDedupLogic() {
  console.log('TESTING DEDUPLICATION LOGIC');
  console.log('='.repeat(100));

  // CORRECT DEDUP:
  // 1. Filter by price > 0.5 (remove complement trades)
  // 2. Group by (trade_time, side, usdc, tokens) - same values = same trade
  const q = `
    WITH all_trades AS (
      SELECT
        event_id,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        token_id,
        trade_time,
        (usdc_amount / 1e6) / (token_amount / 1e6) as price_per_token
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
    ),
    -- Keep only primary trades (price > 0.5)
    primary_trades AS (
      SELECT * FROM all_trades WHERE price_per_token > 0.5
    ),
    -- Dedupe by (trade_time, side, usdc, tokens) - same values = same trade
    deduped AS (
      SELECT
        any(event_id) as event_id,
        side,
        usdc,
        tokens,
        any(token_id) as token_id,
        trade_time,
        any(price_per_token) as price
      FROM primary_trades
      GROUP BY trade_time, side, usdc, tokens
    )
    SELECT * FROM deduped
    ORDER BY trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];

  console.log('After dedup by base_id + side, taking max(usdc):');
  console.log('Total rows: ' + rows.length);

  const buys = rows.filter(r => r.side === 'buy');
  const sells = rows.filter(r => r.side === 'sell');
  const buyTotal = buys.reduce((s, r) => s + Number(r.usdc), 0);
  const sellTotal = sells.reduce((s, r) => s + Number(r.usdc), 0);

  console.log(`\nBuys: ${buys.length} totaling $${buyTotal.toFixed(2)}`);
  console.log(`Sells: ${sells.length} totaling $${sellTotal.toFixed(2)}`);

  console.log('\nAll trades after dedup:');
  for (const row of rows) {
    console.log(`  ${row.side.padEnd(4)} $${Number(row.usdc).toFixed(6).padStart(12)} | ${Number(row.tokens).toFixed(6)} tokens | ${row.trade_time}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log('EXPECTED FROM LEDGER:');
  console.log('  Buys: 11 totaling $20.62');
  console.log('  Sells: 3 totaling $6.56 (plus redemptions for $10.40)');

  // Now filter out the small "complement" sells
  console.log('\n' + '='.repeat(100));
  console.log('FILTERING OUT COMPLEMENT SELLS (usdc < tokens * 0.5):');

  // A complement sell is when usdc << tokens (you're selling the "other side" at a low price)
  // Real sell: usdc ~= tokens * price (where price is meaningful, > 0.5)
  // Complement sell: usdc ~= tokens * (1 - price) where price is high, so usdc is tiny

  const realSells = sells.filter(s => {
    const pricePerToken = Number(s.usdc) / Number(s.tokens);
    return pricePerToken > 0.3; // Real sells have price > 30 cents
  });

  console.log(`Real sells: ${realSells.length} totaling $${realSells.reduce((s, r) => s + Number(r.usdc), 0).toFixed(2)}`);
  for (const s of realSells) {
    const price = Number(s.usdc) / Number(s.tokens);
    console.log(`  $${Number(s.usdc).toFixed(2)} for ${Number(s.tokens).toFixed(4)} tokens @ $${price.toFixed(4)}/token`);
  }

  // Calculate PnL using this clean data
  console.log('\n' + '='.repeat(100));
  console.log('PNL CALCULATION WITH CLEAN DATA:');

  // For CLOB-only, PnL = sum of (sell_price - avg_buy_price) * tokens
  // But we need token-level tracking...

  // Simple version: just cash flow with clean sells
  const cleanCashFlow = realSells.reduce((s, r) => s + Number(r.usdc), 0) - buyTotal;
  console.log(`\nSimple cash flow (clean sells - buys): $${cleanCashFlow.toFixed(2)}`);
  console.log('UI shows: $1.16');
  console.log('Difference: $' + (cleanCashFlow - 1.16).toFixed(2));
}

testDedupLogic();
