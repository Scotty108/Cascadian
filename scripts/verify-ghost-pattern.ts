/**
 * Verify the "Ghost Pattern" across multiple wallets
 * Pattern: UI ~$0, Engine negative, caused by missing CTF Split events
 */

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

interface GhostWallet {
  wallet: string;
  ui_pnl: number;
  v23c_pnl: number;
}

async function checkWalletPattern(wallet: string): Promise<{
  wallet: string;
  clob_trades: number;
  ctf_events: number;
  buy_tokens: number;
  sell_tokens: number;
  token_deficit: number;
  has_split_gap: boolean;
}> {
  // Count CLOB trades
  const clobCount = await clickhouse.query({
    query: `
      SELECT count(DISTINCT event_id) as trades
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const clob = await clobCount.json() as any[];

  // Count CTF events
  const ctfCount = await clickhouse.query({
    query: `
      SELECT count() as events
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const ctf = await ctfCount.json() as any[];

  // Get token buy/sell totals
  const tokenTotals = await clickhouse.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        sumIf(tokens, side = 'buy') as buy_tokens,
        sumIf(tokens, side = 'sell') as sell_tokens
      FROM deduped
    `,
    format: 'JSONEachRow'
  });
  const totals = await tokenTotals.json() as any[];

  const buyTokens = parseFloat(totals[0]?.buy_tokens || 0);
  const sellTokens = parseFloat(totals[0]?.sell_tokens || 0);
  const tokenDeficit = sellTokens - buyTokens;

  return {
    wallet,
    clob_trades: parseInt(clob[0]?.trades || 0),
    ctf_events: parseInt(ctf[0]?.events || 0),
    buy_tokens: buyTokens,
    sell_tokens: sellTokens,
    token_deficit: tokenDeficit,
    has_split_gap: tokenDeficit > 100 && parseInt(ctf[0]?.events || 0) === 0
  };
}

async function main() {
  // Load test results
  const results = JSON.parse(fs.readFileSync('data/proof-of-accuracy-results.json', 'utf8'));

  // Find ghost pattern wallets
  const ghostWallets: GhostWallet[] = results.results.filter((r: any) =>
    r.status === 'PASSED' &&
    Math.abs(r.ui_pnl) < 10 &&
    r.v23c_pnl < -5
  ).slice(0, 5);

  console.log('=== GHOST PATTERN VERIFICATION ===');
  console.log('Testing', ghostWallets.length, 'wallets with UI ~$0 but Engine negative');
  console.log('');
  console.log('Wallet                 | UI PnL   | V23c PnL    | CLOB | CTF  | Token Deficit | Split Gap?');
  console.log('-'.repeat(100));

  let confirmedCount = 0;

  for (const gw of ghostWallets) {
    const result = await checkWalletPattern(gw.wallet);

    const splitGapStr = result.has_split_gap ? 'YES' : 'no';
    if (result.has_split_gap) confirmedCount++;

    console.log(
      `${gw.wallet.slice(0, 20)}... | $${gw.ui_pnl.toFixed(2).padStart(6)} | $${gw.v23c_pnl.toFixed(2).padStart(9)} | ${result.clob_trades.toString().padStart(4)} | ${result.ctf_events.toString().padStart(4)} | ${result.token_deficit.toFixed(0).padStart(13)} | ${splitGapStr}`
    );
  }

  console.log('-'.repeat(100));
  console.log('');
  console.log('=== SUMMARY ===');
  console.log('Wallets with confirmed Split Gap pattern:', confirmedCount, 'of', ghostWallets.length);
  console.log('');
  console.log('A "Split Gap" means: Token Deficit > 100 AND CTF Events = 0');
  console.log('This confirms the wallet sold more tokens than they bought,');
  console.log('but we have no record of how they obtained those tokens (missing Split).');
}

main().catch(console.error);
