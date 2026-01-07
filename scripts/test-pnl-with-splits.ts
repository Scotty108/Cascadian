/**
 * Test PnL calculation with proper CTF split attribution
 *
 * This script:
 * 1. Gets current CCR-v1 PnL (which doesn't know about splits)
 * 2. Gets CTF split events attributed to the wallet via proxy
 * 3. Calculates what the adjusted PnL would be
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
];

async function getCTFSplitData(wallet: string) {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Get split events by matching tx_hash
  const query = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
    SELECT
      ctf.event_type,
      toFloat64OrZero(ctf.amount_or_payout) / 1e6 as amount,
      ctf.condition_id
    FROM pm_ctf_events ctf
    WHERE ctf.tx_hash IN (SELECT tx_hash FROM wallet_hashes)
      AND lower(ctf.user_address) IN (${proxyList})
      AND ctf.is_deleted = 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const events = await result.json() as any[];

  let splitTokens = 0;
  let mergeTokens = 0;
  let redemptionTokens = 0;

  for (const e of events) {
    switch (e.event_type) {
      case 'PositionSplit':
        splitTokens += e.amount;
        break;
      case 'PositionsMerge':
        mergeTokens += e.amount;
        break;
      case 'PayoutRedemption':
        redemptionTokens += e.amount;
        break;
    }
  }

  return {
    splitTokens,
    mergeTokens,
    redemptionTokens,
    // Cost of splits (buy both outcomes at $0.50 each)
    splitCost: splitTokens * 0.50,
    // Proceeds from merges (sell both outcomes at $0.50 each)
    mergeProceeds: mergeTokens * 0.50,
  };
}

async function main() {
  const testWallets = [
    { name: 'f918', addr: '0xf918977ef9d3f101385eda508621d5f835fa9052', uiPnl: 1.16 },
    { name: 'Lheo', addr: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61', uiPnl: 690 },
  ];

  for (const w of testWallets) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`${w.name} - UI PnL: $${w.uiPnl.toLocaleString()}`);
    console.log('='.repeat(70));

    // Get current CCR-v1 metrics
    console.log('\n1. Current CCR-v1 calculation (no split awareness)...');
    const ccrMetrics = await computeCCRv1(w.addr);

    console.log(`   Realized PnL: $${ccrMetrics.realized_pnl.toFixed(2)}`);
    console.log(`   Unrealized PnL: $${ccrMetrics.unrealized_pnl.toFixed(2)}`);
    console.log(`   Total PnL: $${ccrMetrics.total_pnl.toFixed(2)}`);
    console.log(`   External Sell Adjustment: $${ccrMetrics.external_sell_adjustment.toFixed(2)}`);
    console.log(`   External Sell Tokens: ${ccrMetrics.external_sell_tokens.toFixed(2)}`);

    // Get CTF split data
    console.log('\n2. CTF Split data (via proxy)...');
    const ctfData = await getCTFSplitData(w.addr);

    console.log(`   Split tokens: ${ctfData.splitTokens.toFixed(2)} (cost: $${ctfData.splitCost.toFixed(2)} at 50¢)`);
    console.log(`   Merge tokens: ${ctfData.mergeTokens.toFixed(2)} (proceeds: $${ctfData.mergeProceeds.toFixed(2)} at 50¢)`);

    // Calculate adjusted PnL
    console.log('\n3. Adjusted PnL calculation...');

    // The external_sell_adjustment assumed $1.00 cost basis
    // But splits give tokens at $0.50 cost basis
    // So the adjustment was OVER-estimating cost by $0.50 per split token

    // Current formula: realized_pnl includes external_sell_adjustment
    // external_sell_adjustment = external_sell_tokens * (1.00 - sell_price)
    //
    // Correct cost for split tokens should be $0.50, not $1.00
    // So we need to reduce the cost assumption by $0.50 per split token

    // How much of the "external sells" came from splits?
    // If external_sell_tokens matches split_tokens, then 100% came from splits
    const splitRatio = Math.min(ctfData.splitTokens / Math.max(ccrMetrics.external_sell_tokens, 1), 1);

    // The adjustment assumed $1.00 cost basis, but splits are $0.50
    // So we over-deducted by $0.50 per split token
    const costBasisCorrection = ctfData.splitTokens * 0.50;

    // But we also need to subtract the actual cost of the splits
    // Split creates tokens at $0.50 cost - this is real cost that should be deducted
    // Actually no - the split creates TWO tokens for $1 total (so $0.50 each)
    // The CLOB trades already capture the proceeds from selling those tokens
    // What we need to correct is the COST BASIS assumption

    // Let me think about this more carefully:
    // Current CCR-v1: sees SELL of split-originated tokens, assumes $1.00 cost
    // Reality: split tokens have $0.50 cost basis
    // Difference: $0.50 per token OVER-estimated cost
    // Impact on PnL: PnL = proceeds - cost, so if cost was over-estimated, PnL is UNDER-estimated
    // Correction: ADD $0.50 per split token to PnL

    const adjustedRealizedPnl = ccrMetrics.realized_pnl + costBasisCorrection;
    const adjustedTotalPnl = adjustedRealizedPnl + ccrMetrics.unrealized_pnl;

    console.log(`\n   CCR-v1 external_sell_tokens: ${ccrMetrics.external_sell_tokens.toFixed(2)}`);
    console.log(`   CTF split tokens: ${ctfData.splitTokens.toFixed(2)}`);
    console.log(`   Split ratio (of external sells): ${(splitRatio * 100).toFixed(1)}%`);
    console.log(`\n   Cost basis correction: +$${costBasisCorrection.toFixed(2)}`);
    console.log(`   (Split tokens at $0.50 instead of assumed $1.00)`);

    console.log(`\n   ADJUSTED Realized PnL: $${adjustedRealizedPnl.toFixed(2)}`);
    console.log(`   ADJUSTED Total PnL: $${adjustedTotalPnl.toFixed(2)}`);

    // Compare to UI
    console.log('\n4. Comparison to UI...');
    console.log(`   UI PnL: $${w.uiPnl.toLocaleString()}`);
    console.log(`   CCR-v1 (unadjusted): $${ccrMetrics.total_pnl.toFixed(2)} (error: ${((ccrMetrics.total_pnl - w.uiPnl) / Math.abs(w.uiPnl) * 100).toFixed(1)}%)`);
    console.log(`   CCR-v1 (split-adjusted): $${adjustedTotalPnl.toFixed(2)} (error: ${((adjustedTotalPnl - w.uiPnl) / Math.abs(w.uiPnl) * 100).toFixed(1)}%)`);
  }
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
