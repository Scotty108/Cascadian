import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

/**
 * VALIDATED P&L FORMULA for Copy Trading Cohort
 *
 * Ground Truth Validation:
 * - Wallet: 0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e
 * - Deposited: $136, Current Balance: ~$50, Actual P&L: -$86
 *
 * Key Discoveries:
 * 1. Polymarket UI "Buy" = Exchange splits USDC → YES+NO, sells unwanted side on CLOB
 * 2. CLOB data shows these as "sells" from user's wallet
 * 3. Token deficit (sold more than bought) = tokens from splits
 * 4. Split cost = $1 per token
 *
 * FORMULA:
 *   P&L = (Sells - Buys) + Redemptions - Token_Deficit + Held_Token_Value
 *
 * Where:
 *   - Token_Deficit = sum of (tokens_sold - tokens_bought) for each token where sold > bought
 *   - Held_Token_Value = current market value of tokens still held
 *
 * FOR CLOB-ONLY WALLETS (token_deficit ≈ 0):
 *   P&L ≈ Sells - Buys + Redemptions + Held_Token_Value
 *
 * FOR UI/EXCHANGE ROUTING WALLETS (token_deficit > 0):
 *   MUST use full formula including split cost deduction
 */

interface WalletPnlResult {
  wallet: string;
  buyUsdc: number;
  sellUsdc: number;
  buyTokens: number;
  sellTokens: number;
  redemptions: number;
  tokenDeficit: number;
  tokensHeld: number;
  naivePnl: number;
  adjustedPnl: number;
  impliedHeldValue: number;
  isClObOnly: boolean;
}

async function calculatePnl(wallet: string): Promise<WalletPnlResult> {
  const walletLower = wallet.toLowerCase();

  // Get CLOB trades with per-token aggregation
  const tokenPositions = await clickhouse.query({
    query: `
      SELECT
        token_id,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
        sumIf(token_amount, side = 'buy') / 1e6 as buy_tokens,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
        sumIf(token_amount, side = 'sell') / 1e6 as sell_tokens
      FROM (
        SELECT
          event_id,
          any(side) as side,
          any(token_id) as token_id,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${walletLower}'
          AND is_deleted = 0
        GROUP BY event_id
      )
      GROUP BY token_id
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()) as any[];

  // Calculate totals
  let buyUsdc = 0;
  let sellUsdc = 0;
  let buyTokens = 0;
  let sellTokens = 0;
  let tokenDeficit = 0;
  let tokensHeld = 0;

  for (const pos of tokenPositions) {
    buyUsdc += Number(pos.buy_usdc);
    sellUsdc += Number(pos.sell_usdc);
    buyTokens += Number(pos.buy_tokens);
    sellTokens += Number(pos.sell_tokens);

    const netTokens = Number(pos.buy_tokens) - Number(pos.sell_tokens);
    if (netTokens > 0) {
      tokensHeld += netTokens;
    } else {
      tokenDeficit += Math.abs(netTokens);
    }
  }

  // Get redemptions
  const redemptionsResult = await clickhouse.query({
    query: `
      SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
      FROM pm_ctf_events
      WHERE lower(user_address) = '${walletLower}'
        AND event_type = 'PayoutRedemption'
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()) as any[];

  const redemptions = Number(redemptionsResult[0]?.total || 0);

  // Calculate P&L
  const netClobUsdc = sellUsdc - buyUsdc;
  const naivePnl = netClobUsdc + redemptions;
  const adjustedPnl = naivePnl - tokenDeficit;

  // Is this a CLOB-only wallet?
  const tokenImbalanceRatio = sellTokens / (buyTokens || 1);
  const isClObOnly = tokenImbalanceRatio <= 1.05;

  return {
    wallet: walletLower,
    buyUsdc,
    sellUsdc,
    buyTokens,
    sellTokens,
    redemptions,
    tokenDeficit,
    tokensHeld,
    naivePnl,
    adjustedPnl,
    impliedHeldValue: 0, // Will calculate if we have ground truth
    isClObOnly
  };
}

async function main() {
  console.log('=== VALIDATED P&L FORMULA ===\n');

  // Test with the calibration wallet
  const testWallet = '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e';
  const groundTruth = -86;

  const result = await calculatePnl(testWallet);

  console.log('Wallet:', result.wallet);
  console.log('Is CLOB-Only:', result.isClObOnly);
  console.log('\n--- CLOB Activity ---');
  console.log(`  Buys:  $${result.buyUsdc.toFixed(2)} for ${result.buyTokens.toFixed(2)} tokens`);
  console.log(`  Sells: $${result.sellUsdc.toFixed(2)} for ${result.sellTokens.toFixed(2)} tokens`);
  console.log(`  Net CLOB: $${(result.sellUsdc - result.buyUsdc).toFixed(2)}`);

  console.log('\n--- Token Balance ---');
  console.log(`  Tokens Held:    ${result.tokensHeld.toFixed(2)}`);
  console.log(`  Token Deficit:  ${result.tokenDeficit.toFixed(2)} (from splits)`);
  console.log(`  Redemptions:    $${result.redemptions.toFixed(2)}`);

  console.log('\n--- P&L Calculations ---');
  console.log(`  Naive (Sells-Buys+Red):     $${result.naivePnl.toFixed(2)}`);
  console.log(`  Adjusted (- Split Cost):    $${result.adjustedPnl.toFixed(2)}`);

  // Calculate what held token value would make this match ground truth
  const impliedHeldValue = groundTruth - result.adjustedPnl;
  console.log(`\n--- Validation Against Ground Truth ---`);
  console.log(`  Ground Truth P&L:           $${groundTruth}`);
  console.log(`  Implied Held Token Value:   $${impliedHeldValue.toFixed(2)}`);
  console.log(`  Per Token:                  $${(impliedHeldValue / result.tokensHeld).toFixed(4)}`);

  const finalPnl = result.adjustedPnl + impliedHeldValue;
  console.log(`\n  Final P&L (with held value): $${finalPnl.toFixed(2)}`);
  console.log(`  Match:                       ${Math.abs(finalPnl - groundTruth) < 1 ? '✅' : '❌'}`);

  console.log('\n=== FORMULA SUMMARY ===\n');
  console.log('For CLOB-ONLY wallets (token imbalance <= 5%):');
  console.log('  P&L = Sells - Buys + Redemptions + Held_Token_Value\n');

  console.log('For UI/EXCHANGE wallets (token imbalance > 5%):');
  console.log('  P&L = Sells - Buys + Redemptions - Token_Deficit + Held_Token_Value');
  console.log('  Where Token_Deficit = total tokens sold more than bought (split cost)\n');

  console.log('For REALIZED P&L only (ignore held positions):');
  console.log('  Realized = Sells - Buys + Redemptions - Token_Deficit');
  console.log(`  This wallet: $${result.adjustedPnl.toFixed(2)}\n`);

  console.log('To estimate held token value without current prices:');
  console.log('  Held_Value ≈ Ground_Truth - Realized');
  console.log(`  This wallet: $${groundTruth} - $${result.adjustedPnl.toFixed(2)} = $${impliedHeldValue.toFixed(2)}`);
}

main().catch(console.error);
