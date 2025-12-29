#!/usr/bin/env npx tsx
/**
 * Test Ledger PnL Engine V1 against regression wallets
 *
 * For each wallet:
 * 1. Load all trade events (both maker + taker)
 * 2. Load all ERC1155 transfers
 * 3. Load settlement/redemption events
 * 4. Run through ledger engine
 * 5. Compare against UI tooltip values
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import { LedgerPnlEngine } from '../../lib/pnl/engines/ledgerPnlEngineV1';
import * as fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 60000, // 60 seconds
});

// Load regression fixtures
const fixtures = JSON.parse(
  fs.readFileSync('lib/pnl/__tests__/fixtures/ui-regression-wallets.json', 'utf-8')
);

interface TradeEvent {
  event_id: string;
  trade_time: string;
  token_id: string;
  side: string;
  usdc_amount: number;
  token_amount: number;
}

interface TransferEvent {
  tx_hash: string;
  block_time: string;
  token_id: string;
  from_address: string;
  to_address: string;
  amount: number;
}

async function loadTradeEvents(wallet: string): Promise<TradeEvent[]> {
  const q = await clickhouse.query({
    query: `
      SELECT
        event_id,
        trade_time,
        token_id,
        side,
        usdc_amount / 1000000.0 as usdc_amount,
        token_amount / 1000000.0 as token_amount
      FROM (
        SELECT
          event_id,
          any(trade_time) as trade_time,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = {wallet:String}
          AND is_deleted = 0
        GROUP BY event_id
      )
      ORDER BY trade_time ASC
    `,
    query_params: { wallet: wallet.toLowerCase() },
    format: 'JSONEachRow'
  });
  return await q.json() as TradeEvent[];
}

async function loadTransfers(wallet: string): Promise<{ incoming: TransferEvent[], outgoing: TransferEvent[] }> {
  // Skip transfer loading for now - will add when implementing cost basis propagation
  // The transfer table queries are slow without proper indexes
  return { incoming: [], outgoing: [] };
}

async function testWallet(walletData: any) {
  const wallet = walletData.wallet.toLowerCase();
  const uiNetTotal = walletData.ui_tooltip.net_total;

  console.log('\n' + '='.repeat(100));
  console.log(`WALLET: ${wallet}`);
  console.log(`Username: ${walletData.username || 'N/A'}`);
  console.log(`UI Net Total: $${uiNetTotal?.toFixed(2) || 'N/A'}`);
  console.log(`Cohort PnL: $${walletData.cohort_pnl.toFixed(2)}`);
  console.log('='.repeat(100));

  // Load events
  const trades = await loadTradeEvents(wallet);
  const transfers = await loadTransfers(wallet);

  console.log(`\nLoaded: ${trades.length} trades, ${transfers.incoming.length} transfers in, ${transfers.outgoing.length} transfers out`);

  // Create engine
  const engine = new LedgerPnlEngine(wallet);

  // Process trades in chronological order
  for (const trade of trades) {
    engine.processTrade({
      eventId: trade.event_id,
      timestamp: new Date(trade.trade_time),
      tokenId: trade.token_id,
      side: trade.side.toLowerCase() as 'buy' | 'sell',
      shares: trade.token_amount,
      usdcAmount: trade.usdc_amount,
    });
  }

  // Get result (without transfers for now - need to implement cost basis propagation)
  const result = engine.getResult();

  console.log('\n--- Engine Results (Trades Only) ---');
  console.log(`Realized PnL: $${result.realizedPnl.toFixed(2)}`);
  console.log(`Total Volume: $${result.totalVolume.toFixed(2)}`);
  console.log(`Gain: +$${result.gain.toFixed(2)}`);
  console.log(`Loss: $${result.loss.toFixed(2)}`);
  console.log(`Trade Count: ${result.debug.tradeCount}`);

  // Compare with UI
  if (uiNetTotal !== null) {
    const delta = result.realizedPnl - uiNetTotal;
    const ratio = uiNetTotal !== 0 ? result.realizedPnl / uiNetTotal : 0;

    console.log('\n--- Comparison vs UI ---');
    console.log(`Engine PnL:  $${result.realizedPnl.toFixed(2)}`);
    console.log(`UI PnL:      $${uiNetTotal.toFixed(2)}`);
    console.log(`Delta:       $${delta.toFixed(2)}`);
    console.log(`Ratio:       ${ratio.toFixed(3)}x`);

    // Check acceptance criteria
    const threshold = Math.abs(uiNetTotal) > 500 ? 25 : 5;
    const signMatch = (result.realizedPnl >= 0) === (uiNetTotal >= 0);
    const withinTolerance = Math.abs(delta) <= threshold;

    if (!signMatch) {
      console.log(`\n❌ FAIL: Sign flip (engine: ${result.realizedPnl >= 0 ? '+' : '-'}, UI: ${uiNetTotal >= 0 ? '+' : '-'})`);
    } else if (withinTolerance) {
      console.log(`\n✅ PASS: Within $${threshold} tolerance`);
    } else {
      console.log(`\n⚠️ FAIL: Delta $${Math.abs(delta).toFixed(2)} exceeds $${threshold} tolerance`);
    }
  }

  // Show top inventory positions
  console.log('\n--- Top Inventory (remaining shares) ---');
  const sortedInv = [...result.inventory.entries()]
    .filter(([, inv]) => inv.shares > 0.01)
    .sort((a, b) => b[1].costBasis - a[1].costBasis)
    .slice(0, 5);

  for (const [tokenId, inv] of sortedInv) {
    const avgCost = inv.shares > 0 ? inv.costBasis / inv.shares : 0;
    console.log(`  ${tokenId.slice(0, 20)}...: ${inv.shares.toFixed(2)} shares @ $${avgCost.toFixed(4)} avg = $${inv.costBasis.toFixed(2)} basis`);
  }

  // Show top cash flow events
  console.log('\n--- Top 10 Cash Flow Events (by absolute USDC) ---');
  const sortedEvents = [...result.events]
    .sort((a, b) => Math.abs(b.usdcAmount) - Math.abs(a.usdcAmount))
    .slice(0, 10);

  for (const evt of sortedEvents) {
    const sign = evt.side === 'sell' ? '+' : '-';
    console.log(`  ${evt.type.padEnd(12)} ${evt.side?.padEnd(4) || '    '} $${sign}${Math.abs(evt.usdcAmount).toFixed(2).padStart(10)} | ${evt.shares.toFixed(2)} shares`);
  }

  return {
    wallet,
    enginePnl: result.realizedPnl,
    uiPnl: uiNetTotal,
    delta: uiNetTotal ? result.realizedPnl - uiNetTotal : null,
    pass: uiNetTotal ? (
      (result.realizedPnl >= 0) === (uiNetTotal >= 0) &&
      Math.abs(result.realizedPnl - uiNetTotal) <= (Math.abs(uiNetTotal) > 500 ? 25 : 5)
    ) : null,
  };
}

async function main() {
  console.log('='.repeat(100));
  console.log('LEDGER PNL ENGINE V1 - REGRESSION TEST');
  console.log('='.repeat(100));
  console.log(`Testing ${fixtures.wallets.length} wallets from regression fixture`);
  console.log(`Acceptance: ±$5 for small PnL, ±$25 for large PnL, no sign flips`);

  const results = [];

  // Test Patapam222 first (best data match)
  const patapam = fixtures.wallets.find((w: any) => w.username === 'Patapam222');
  if (patapam) {
    results.push(await testWallet(patapam));
  }

  // Test mnfgia (second best data match)
  const mnfgia = fixtures.wallets.find((w: any) => w.username === 'mnfgia');
  if (mnfgia) {
    results.push(await testWallet(mnfgia));
  }

  // Test remaining wallets
  for (const walletData of fixtures.wallets) {
    if (walletData.username === 'Patapam222' || walletData.username === 'mnfgia') continue;
    results.push(await testWallet(walletData));
  }

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));

  const passed = results.filter(r => r.pass === true).length;
  const failed = results.filter(r => r.pass === false).length;
  const unknown = results.filter(r => r.pass === null).length;

  console.log(`\nPass: ${passed}/${results.length}`);
  console.log(`Fail: ${failed}/${results.length}`);
  console.log(`Unknown (no UI value): ${unknown}/${results.length}`);

  console.log('\n--- Per-Wallet Results ---');
  for (const r of results) {
    const status = r.pass === true ? '✅' : r.pass === false ? '❌' : '❓';
    console.log(`${status} ${r.wallet.slice(0, 10)}... | Engine: $${r.enginePnl?.toFixed(2).padStart(10)} | UI: $${r.uiPnl?.toFixed(2).padStart(10) || 'N/A'.padStart(10)} | Delta: $${r.delta?.toFixed(2).padStart(8) || 'N/A'.padStart(8)}`);
  }

  await clickhouse.close();
}

main().catch(console.error);
