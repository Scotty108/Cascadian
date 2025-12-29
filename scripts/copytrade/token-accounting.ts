/**
 * Token-level accounting to derive splits from fills alone
 *
 * Conservation law:
 * Tokens_bought + Tokens_from_splits = Tokens_sold + Tokens_redeemed + Tokens_held
 *
 * If all positions closed (Tokens_held = 0):
 * Tokens_from_splits = Tokens_sold + Tokens_redeemed - Tokens_bought
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e';

async function main() {
  console.log('=== Token-Level Accounting for P&L Derivation ===\n');
  console.log('Wallet:', WALLET);
  console.log('Goal: Derive split cost from fills alone (no external balance)\n');

  // 1. Get CLOB token totals (with dedup)
  console.log('--- 1. CLOB Token Totals (with GROUP BY event_id dedup) ---');
  const clobQuery = `
    SELECT
      sumIf(tokens, side = 'buy') as tokens_bought,
      sumIf(tokens, side = 'sell') as tokens_sold,
      sumIf(usdc, side = 'buy') as usdc_bought,
      sumIf(usdc, side = 'sell') as usdc_sold
    FROM (
      SELECT
        event_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${WALLET}')
      GROUP BY event_id
    )
  `;
  const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
  const clob = (await clobResult.json())[0] as any;

  const tokensBought = Number(clob.tokens_bought);
  const tokensSold = Number(clob.tokens_sold);
  const usdcBought = Number(clob.usdc_bought);
  const usdcSold = Number(clob.usdc_sold);

  console.log('Tokens bought on CLOB:', tokensBought.toFixed(2));
  console.log('Tokens sold on CLOB:', tokensSold.toFixed(2));
  console.log('USDC spent on buys: $' + usdcBought.toFixed(2));
  console.log('USDC from sells: $' + usdcSold.toFixed(2));

  // 2. Get redemption token amounts from CTF events
  console.log('\n--- 2. Redemption Token Amounts ---');
  const redemptionQuery = `
    SELECT
      sum(amount / 1e6) as total_tokens_redeemed,
      count() as redemption_count
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${WALLET}')
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const redemptionResult = await clickhouse.query({ query: redemptionQuery, format: 'JSONEachRow' });
  const redemption = (await redemptionResult.json())[0] as any;

  const tokensRedeemed = Number(redemption.total_tokens_redeemed) || 0;
  const redemptionCount = Number(redemption.redemption_count) || 0;

  console.log('Total tokens redeemed:', tokensRedeemed.toFixed(2));
  console.log('Redemption events:', redemptionCount);

  // 3. Get redemption USDC payouts
  console.log('\n--- 3. Redemption USDC Payouts ---');
  const payoutQuery = `
    SELECT
      sum(payout_amount / 1e6) as total_payout_usdc
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${WALLET}')
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
  `;
  const payoutResult = await clickhouse.query({ query: payoutQuery, format: 'JSONEachRow' });
  const payout = (await payoutResult.json())[0] as any;

  const usdcFromRedemptions = Number(payout.total_payout_usdc) || 0;

  console.log('Total redemption USDC: $' + usdcFromRedemptions.toFixed(2));

  // 4. Token conservation formula
  console.log('\n--- 4. Token Conservation Analysis ---');
  const tokensHeld = 0; // UI confirmed no positions

  // Formula: splits = sold + redeemed + held - bought
  const tokensFromSplits = tokensSold + tokensRedeemed - tokensBought;

  console.log('\nToken conservation equation:');
  console.log('  bought + splits = sold + redeemed + held');
  console.log('  ' + tokensBought.toFixed(2) + ' + splits = ' + tokensSold.toFixed(2) + ' + ' + tokensRedeemed.toFixed(2) + ' + ' + tokensHeld);
  console.log('\n  Solving for splits:');
  console.log('  splits = ' + tokensSold.toFixed(2) + ' + ' + tokensRedeemed.toFixed(2) + ' - ' + tokensBought.toFixed(2));
  console.log('  splits = ' + tokensFromSplits.toFixed(2) + ' tokens');

  // 5. Calculate P&L from derived splits
  console.log('\n--- 5. P&L Calculation from Derived Splits ---');
  const splitCost = tokensFromSplits; // Each split costs $1 USDC

  console.log('\nCash flow components:');
  console.log('  + USDC from sells: $' + usdcSold.toFixed(2));
  console.log('  + USDC from redemptions: $' + usdcFromRedemptions.toFixed(2));
  console.log('  - USDC on buys: $' + usdcBought.toFixed(2));
  console.log('  - USDC on splits: $' + splitCost.toFixed(2) + ' (derived from token conservation)');

  const calculatedPnl = usdcSold + usdcFromRedemptions - usdcBought - splitCost;

  console.log('\n  P&L = sells + redemptions - buys - splits');
  console.log('  P&L = $' + usdcSold.toFixed(2) + ' + $' + usdcFromRedemptions.toFixed(2) + ' - $' + usdcBought.toFixed(2) + ' - $' + splitCost.toFixed(2));
  console.log('  P&L = $' + calculatedPnl.toFixed(2));

  console.log('\n--- 6. Validation ---');
  const groundTruth = -86.66;
  console.log('  Ground truth P&L: -$86.66');
  console.log('  Calculated P&L: $' + calculatedPnl.toFixed(2));
  console.log('  Difference: $' + (calculatedPnl - groundTruth).toFixed(2));

  if (Math.abs(calculatedPnl - groundTruth) < 1) {
    console.log('\n✅ SUCCESS: Token conservation formula works!');
  } else {
    console.log('\n❌ GAP: Need to investigate further');

    // Check what's missing
    console.log('\n--- 7. Investigating Gap ---');

    // Required split cost for exact match
    const requiredSplits = usdcSold + usdcFromRedemptions - usdcBought - groundTruth;
    console.log('  Required split cost for -$86.66: $' + requiredSplits.toFixed(2));
    console.log('  Our derived split cost: $' + splitCost.toFixed(2));
    console.log('  Difference: $' + (splitCost - requiredSplits).toFixed(2));

    // Check for unmapped redemptions
    console.log('\n--- 8. Checking for Unmapped/Missing Data ---');

    // Check condition-level redemptions
    const conditionRedemptionsQuery = `
      SELECT
        condition_id,
        sum(amount / 1e6) as tokens,
        sum(payout_amount / 1e6) as payout
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${WALLET}')
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      GROUP BY condition_id
    `;
    const conditionResult = await clickhouse.query({ query: conditionRedemptionsQuery, format: 'JSONEachRow' });
    const conditions = await conditionResult.json() as any[];

    console.log('  Redemptions by condition_id:');
    conditions.forEach((c: any) => {
      const tokens = Number(c.tokens);
      const payout = Number(c.payout);
      const payoutPerToken = tokens > 0 ? payout / tokens : 0;
      console.log('    ' + c.condition_id.slice(0, 16) + '... : ' + tokens.toFixed(2) + ' tokens -> $' + payout.toFixed(2) + ' (payout/token: $' + payoutPerToken.toFixed(4) + ')');
    });

    // Check ERC1155 transfers that might represent redemptions
    console.log('\n--- 9. ERC1155 Burns (potential redemptions) ---');
    const burnQuery = `
      SELECT
        token_id,
        sum(value / 1e6) as tokens_burned
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = lower('${WALLET}')
        AND to_address = '0x0000000000000000000000000000000000000000'
        AND is_deleted = 0
      GROUP BY token_id
    `;
    const burnResult = await clickhouse.query({ query: burnQuery, format: 'JSONEachRow' });
    const burns = await burnResult.json() as any[];

    const totalBurned = burns.reduce((sum: number, b: any) => sum + Number(b.tokens_burned), 0);
    console.log('  Total tokens burned (ERC1155 -> 0x0): ' + totalBurned.toFixed(2));
    console.log('  Burn events count: ' + burns.length);

    // Recalculate with burns as redemptions
    if (totalBurned > 0 && totalBurned !== tokensRedeemed) {
      console.log('\n--- 10. Recalculation with ERC1155 Burns ---');
      const tokensFromSplitsV2 = tokensSold + totalBurned - tokensBought;
      console.log('  Using burned tokens as redemption count: ' + totalBurned.toFixed(2));
      console.log('  New derived splits: ' + tokensFromSplitsV2.toFixed(2));

      const calculatedPnlV2 = usdcSold + usdcFromRedemptions - usdcBought - tokensFromSplitsV2;
      console.log('  New calculated P&L: $' + calculatedPnlV2.toFixed(2));
      console.log('  Difference from ground truth: $' + (calculatedPnlV2 - groundTruth).toFixed(2));
    }
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
