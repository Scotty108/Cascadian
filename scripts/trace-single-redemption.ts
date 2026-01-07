/**
 * Trace a single redemption through CCR-v1 logic to debug
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import { emptyPosition, updateWithBuy, updateWithSell } from '../lib/pnl/costBasisEngineV1';

const WALLET = '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';
const CONDITION = '968d3276c9394b83ddc0368efa907df16d1fbf38abb73a18819138ff0f30f16e';

async function main() {
  console.log('Tracing Single Redemption\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Condition: ...${CONDITION.slice(-12)}`);
  console.log('='.repeat(60));

  // 1. Get token mapping
  const mapQuery = `
    SELECT token_id_dec, outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) = lower('${CONDITION}')
  `;
  const mapResult = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' });
  const mappings = (await mapResult.json()) as any[];

  const token0 = mappings.find(m => m.outcome_index === 0)?.token_id_dec;
  const token1 = mappings.find(m => m.outcome_index === 1)?.token_id_dec;

  console.log(`\nToken mappings:`);
  console.log(`  Outcome 0: ...${token0?.slice(-12) || 'MISSING'}`);
  console.log(`  Outcome 1: ...${token1?.slice(-12) || 'MISSING'}`);

  // 2. Get CLOB trades for this condition
  const clobQuery = `
    SELECT
      event_id,
      side,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      token_id,
      trade_time
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND token_id IN ('${token0}', '${token1}')
      AND is_deleted = 0
      AND role = 'maker'
    ORDER BY trade_time
  `;
  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clobTrades = (await clobResult.json()) as any[];

  console.log(`\nCLOB trades: ${clobTrades.length}`);
  for (const t of clobTrades) {
    console.log(`  ${t.trade_time} | ${t.side} | $${t.usdc.toFixed(2)} | ${t.tokens.toFixed(2)} tokens | ...${t.token_id.slice(-12)}`);
  }

  // 3. Get redemption event
  const redemptionQuery = `
    SELECT
      amount_or_payout,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${WALLET}')
      AND lower(condition_id) = lower('${CONDITION}')
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const redemptionResult = await clickhouse.query({ query: redemptionQuery, format: 'JSONEachRow' });
  const redemptions = (await redemptionResult.json()) as any[];

  console.log(`\nRedemption events: ${redemptions.length}`);
  for (const r of redemptions) {
    console.log(`  ${r.event_timestamp} | ${r.amount.toFixed(2)} tokens redeemed`);
  }

  // 4. Get resolution
  const resQuery = `
    SELECT payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) = lower('${CONDITION}')
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions = (await resResult.json()) as any[];

  console.log(`\nResolution: ${resolutions[0]?.payout_numerators || 'NOT RESOLVED'}`);

  // 5. Simulate cost basis processing
  console.log('\n=== SIMULATING COST BASIS PROCESSING ===\n');

  let position0 = emptyPosition(WALLET, token0 || '');
  let position1 = emptyPosition(WALLET, token1 || '');

  // Process CLOB trades
  for (const t of clobTrades) {
    const pos = t.token_id === token0 ? position0 : position1;
    const price = t.usdc / t.tokens;

    if (t.side === 'buy') {
      const newPos = updateWithBuy(pos, t.tokens, price);
      if (t.token_id === token0) position0 = newPos;
      else position1 = newPos;
      console.log(`BUY: ${t.tokens.toFixed(2)} tokens at $${price.toFixed(4)}`);
      console.log(`  → Position: ${newPos.amount.toFixed(2)} tokens, avgPrice: $${newPos.avgPrice.toFixed(4)}`);
    } else {
      const { position: newPos, result } = updateWithSell(pos, t.tokens, price);
      if (t.token_id === token0) position0 = newPos;
      else position1 = newPos;
      console.log(`SELL: ${t.tokens.toFixed(2)} tokens at $${price.toFixed(4)}`);
      console.log(`  → Realized: $${result.realizedPnl.toFixed(2)}, External: ${result.externalSell.toFixed(2)}`);
      console.log(`  → Position: ${newPos.amount.toFixed(2)} tokens, realizedPnl: $${newPos.realizedPnl.toFixed(2)}`);
    }
  }

  console.log(`\nBefore redemption:`);
  console.log(`  Position0: ${position0.amount.toFixed(2)} tokens, avgPrice: $${position0.avgPrice.toFixed(4)}, realizedPnl: $${position0.realizedPnl.toFixed(2)}`);
  console.log(`  Position1: ${position1.amount.toFixed(2)} tokens, avgPrice: $${position1.avgPrice.toFixed(4)}, realizedPnl: $${position1.realizedPnl.toFixed(2)}`);

  // Process redemption
  if (redemptions.length > 0) {
    const r = redemptions[0];
    const payout0 = 1.0; // Winner (from resolution [1,0])
    const payout1 = 0.0; // Loser

    console.log(`\nProcessing redemption of ${r.amount.toFixed(2)} tokens:`);

    // Add redemption sell for winner
    if (payout0 > 0) {
      const { position: newPos, result } = updateWithSell(position0, r.amount, payout0);
      position0 = newPos;
      console.log(`  Outcome 0 (winner): SELL ${r.amount.toFixed(2)} at $${payout0.toFixed(2)}`);
      console.log(`    → Realized: $${result.realizedPnl.toFixed(2)}, External: ${result.externalSell.toFixed(2)}`);
    }
  }

  console.log(`\nFinal state:`);
  console.log(`  Position0: ${position0.amount.toFixed(2)} tokens, realizedPnl: $${position0.realizedPnl.toFixed(2)}`);
  console.log(`  Position1: ${position1.amount.toFixed(2)} tokens, realizedPnl: $${position1.realizedPnl.toFixed(2)}`);
  console.log(`  Total realized: $${(position0.realizedPnl + position1.realizedPnl).toFixed(2)}`);

  // V6 comparison
  console.log('\n=== V6 COMPARISON ===');
  const v6Query = `
    SELECT
      source_type,
      sum(usdc_delta) as cash,
      sum(token_delta) as tokens
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND lower(condition_id) = lower('${CONDITION}')
    GROUP BY source_type
  `;
  const v6Result = await clickhouse.query({ query: v6Query, format: 'JSONEachRow' });
  const v6Rows = (await v6Result.json()) as any[];

  let v6Cash = 0;
  let v6Tokens = 0;
  for (const row of v6Rows) {
    console.log(`  ${row.source_type}: cash=$${row.cash.toFixed(2)}, tokens=${row.tokens.toFixed(2)}`);
    v6Cash += row.cash;
    v6Tokens += row.tokens;
  }
  console.log(`  Total: cash=$${v6Cash.toFixed(2)}, tokens=${v6Tokens.toFixed(2)}`);
  console.log(`  V6 PnL (resolved at 1.0): $${(v6Cash + v6Tokens * 1.0).toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
