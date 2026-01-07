/**
 * Test PnL calculation with refined CTF split attribution
 *
 * Key insight: We can only correct the cost basis for splits that were SOLD
 * The external_sell_tokens tells us how many tokens were sold without tracked cost basis
 * The split_tokens tells us how many tokens were created via splits
 * The correction should be MIN(external_sells, splits) * $0.50
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { computeCCRv1 } from '../lib/pnl/ccrEngineV1';

const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
];

async function getCTFData(wallet: string) {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  const query = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
    SELECT
      ctf.event_type,
      toFloat64OrZero(ctf.amount_or_payout) / 1e6 as amount
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

  return { splitTokens, mergeTokens, redemptionTokens };
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

    const ccrMetrics = await computeCCRv1(w.addr);
    const ctfData = await getCTFData(w.addr);

    console.log('\n1. Raw data:');
    console.log(`   CCR-v1 Total PnL: $${ccrMetrics.total_pnl.toFixed(2)}`);
    console.log(`   External sell tokens: ${ccrMetrics.external_sell_tokens.toFixed(2)}`);
    console.log(`   External sell adjustment: $${ccrMetrics.external_sell_adjustment.toFixed(2)}`);
    console.log(`   CTF split tokens: ${ctfData.splitTokens.toFixed(2)}`);
    console.log(`   CTF merge tokens: ${ctfData.mergeTokens.toFixed(2)}`);

    // REFINED ADJUSTMENT:
    // The external_sell_adjustment assumed tokens came with $1.00 cost basis
    // But split-originated tokens have $0.50 cost basis
    // We can only correct for the overlap: tokens that are BOTH external sells AND from splits

    // For each split token, BOTH outcomes are created
    // If we split 10 USDC, we get 10 YES tokens + 10 NO tokens (20 tokens total)
    // But amount_or_payout shows the collateral amount (10), not total tokens (20)
    // So split creates 2x tokens per amount
    const splitTokensTotal = ctfData.splitTokens * 2; // Both outcomes

    // The overlap is the min of external sells and split-originated tokens
    const splitOverlap = Math.min(ccrMetrics.external_sell_tokens, splitTokensTotal);

    // Current assumption: $1.00 cost basis for external sells
    // Correct assumption for splits: $0.50 cost basis
    // Difference: $0.50 per token
    // Direction: we OVER-estimated cost, so PnL was UNDER-estimated
    // Correction: ADD $0.50 * overlap
    const costBasisCorrection = splitOverlap * 0.50;

    // But wait - the external_sell_adjustment already ADDED cost (reduced PnL)
    // Actually let me re-check the CCR-v1 logic...
    // external_sell_adjustment = (1.0 - avgSellPrice) * external_sell_tokens
    // This ADDS cost (negative adjustment to PnL) when avgSellPrice < 1.0
    // So if we assumed $1.00 cost but actual was $0.50, we added too much cost
    // Correction: REMOVE the excess cost = add back $0.50 * overlap

    const adjustedTotalPnl = ccrMetrics.total_pnl + costBasisCorrection;

    console.log('\n2. Refined adjustment (accounting for split doubles):');
    console.log(`   Split creates both outcomes: ${ctfData.splitTokens.toFixed(2)} → ${splitTokensTotal.toFixed(2)} tokens`);
    console.log(`   Overlap with external sells: ${splitOverlap.toFixed(2)} tokens`);
    console.log(`   Cost basis correction: +$${costBasisCorrection.toFixed(2)}`);
    console.log(`   Adjusted Total PnL: $${adjustedTotalPnl.toFixed(2)}`);

    // Alternative: Maybe the split amount IS the total tokens (not collateral)
    // Let's also calculate that way
    const splitOverlapAlt = Math.min(ccrMetrics.external_sell_tokens, ctfData.splitTokens);
    const correctionAlt = splitOverlapAlt * 0.50;
    const adjustedAlt = ccrMetrics.total_pnl + correctionAlt;

    console.log('\n3. Alternative (if split amount = tokens, not collateral):');
    console.log(`   Overlap: ${splitOverlapAlt.toFixed(2)} tokens`);
    console.log(`   Correction: +$${correctionAlt.toFixed(2)}`);
    console.log(`   Adjusted PnL: $${adjustedAlt.toFixed(2)}`);

    // Compare
    console.log('\n4. Comparison to UI:');
    console.log(`   UI PnL: $${w.uiPnl.toLocaleString()}`);
    console.log(`   CCR-v1 unadjusted: $${ccrMetrics.total_pnl.toFixed(2)} (${((ccrMetrics.total_pnl - w.uiPnl) / Math.abs(w.uiPnl) * 100).toFixed(1)}% error)`);
    console.log(`   2x split adjustment: $${adjustedTotalPnl.toFixed(2)} (${((adjustedTotalPnl - w.uiPnl) / Math.abs(w.uiPnl) * 100).toFixed(1)}% error)`);
    console.log(`   1x split adjustment: $${adjustedAlt.toFixed(2)} (${((adjustedAlt - w.uiPnl) / Math.abs(w.uiPnl) * 100).toFixed(1)}% error)`);
  }
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
