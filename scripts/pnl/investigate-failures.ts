#!/usr/bin/env npx tsx
/**
 * Investigate Failing Wallets
 *
 * Deep dive into wallets where our CLOB-only calculation doesn't match UI
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const COLLATERAL_SCALE = 1_000_000n;

// Failing wallets from cohort analysis
const INVESTIGATE = [
  { wallet: '0x8c2758e0feed42b74fc6bce65bf18fe975e1f9e3', uiPnl: -34.00, note: 'Shows $0 calc, UI -$34' },
  { wallet: '0xbc51223c95844056730ff0ca973ff23f8f0fee19', uiPnl: 20.55, note: 'Shows $0.11 calc, UI +$20.55' },
  { wallet: '0xb29630d7b3c3b6d3f5d9ee9b22ad20c2c7e1cc61', uiPnl: -117.58, note: 'Sign flip: +$43 vs -$117' },
];

interface Trade {
  trade_time: string;
  transaction_hash: string;
  token_id: string;
  side: string;
  token_amount: number;
  usdc_amount: number;
}

async function investigateWallet(wallet: string, uiPnl: number, note: string) {
  console.log('\n' + '='.repeat(100));
  console.log('INVESTIGATING: ' + wallet);
  console.log('UI PnL: $' + uiPnl.toFixed(2) + ' | Note: ' + note);
  console.log('='.repeat(100));

  // Get raw trades with full detail
  const tradesQ = await clickhouse.query({
    query: `
      SELECT
        trade_time,
        transaction_hash,
        token_id,
        side,
        token_amount,
        usdc_amount
      FROM (
        SELECT
          transaction_hash,
          lower(trader_wallet) as wallet,
          token_id,
          side,
          usdc_amount,
          token_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
          AND is_deleted = 0
        GROUP BY transaction_hash, wallet, token_id, side, usdc_amount, token_amount
      )
      ORDER BY token_id, trade_time
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQ.json() as Trade[];

  console.log('\nTotal trades: ' + trades.length);

  // Group by token
  const byToken = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!byToken.has(t.token_id)) byToken.set(t.token_id, []);
    byToken.get(t.token_id)!.push(t);
  }

  console.log('Unique tokens: ' + byToken.size + '\n');

  // Calculate per-token PnL with full trace
  let totalPnl = 0n;

  for (const [tokenId, tokenTrades] of byToken.entries()) {
    console.log('--- Token ' + tokenId.slice(0, 20) + '... (' + tokenTrades.length + ' trades) ---');

    let amount = 0n;
    let avgPrice = 0n;
    let realizedPnl = 0n;

    for (const t of tokenTrades) {
      const tokenAmt = BigInt(Math.round(t.token_amount));
      const usdcAmt = BigInt(Math.round(t.usdc_amount));
      const price = tokenAmt > 0n ? (usdcAmt * COLLATERAL_SCALE) / tokenAmt : 0n;

      if (t.side === 'buy') {
        if (amount === 0n) {
          avgPrice = price;
        } else {
          avgPrice = (avgPrice * amount + price * tokenAmt) / (amount + tokenAmt);
        }
        amount += tokenAmt;
        console.log('  BUY  ' + (Number(tokenAmt)/1e6).toFixed(2) + ' @ $' + (Number(price)/1e6).toFixed(4) +
          ' → pos=' + (Number(amount)/1e6).toFixed(2) + ', avg=$' + (Number(avgPrice)/1e6).toFixed(4));
      } else {
        const adjusted = tokenAmt > amount ? amount : tokenAmt;
        if (adjusted > 0n) {
          const delta = (adjusted * (price - avgPrice)) / COLLATERAL_SCALE;
          realizedPnl += delta;
          amount -= adjusted;
          console.log('  SELL ' + (Number(tokenAmt)/1e6).toFixed(2) + ' (adj=' + (Number(adjusted)/1e6).toFixed(2) +
            ') @ $' + (Number(price)/1e6).toFixed(4) + ' → PnL=$' + (Number(delta)/1e6).toFixed(2) +
            ', pos=' + (Number(amount)/1e6).toFixed(2));
        }
        if (tokenAmt > adjusted) {
          console.log('    [SELL CAPPED: ' + (Number(tokenAmt - adjusted)/1e6).toFixed(2) + ' ignored - no position]');
        }
      }
    }

    totalPnl += realizedPnl;
    console.log('  Token PnL: $' + (Number(realizedPnl)/1e6).toFixed(2) + ', Open position: ' + (Number(amount)/1e6).toFixed(2) + '\n');
  }

  const calcPnl = Number(totalPnl) / 1e6;
  const delta = calcPnl - uiPnl;

  console.log('SUMMARY:');
  console.log('  Calculated: $' + calcPnl.toFixed(2));
  console.log('  UI Target:  $' + uiPnl.toFixed(2));
  console.log('  Delta:      $' + delta.toFixed(2));
}

async function main() {
  for (const w of INVESTIGATE) {
    await investigateWallet(w.wallet, w.uiPnl, w.note);
  }
  await clickhouse.close();
}

main().catch(console.error);
