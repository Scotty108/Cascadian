import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

/**
 * Reverse engineer the correct P&L formula using a known wallet
 *
 * Ground truth:
 * - Wallet: 0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e
 * - Deposited: $136
 * - Current balance: ~$50
 * - Actual P&L: -$86
 */

const WALLET = '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e'.toLowerCase();
const GROUND_TRUTH_PNL = -86;

async function main() {
  console.log('=== REVERSE ENGINEERING P&L FORMULA ===\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Ground Truth P&L: $${GROUND_TRUTH_PNL}\n`);

  // Step 1: Get all CLOB trades (with deduplication)
  console.log('--- Step 1: Fetching CLOB trades (deduplicated) ---');
  const tradesQuery = `
    SELECT
      side,
      sum(usdc) as total_usdc,
      sum(tokens) as total_tokens,
      count(*) as trade_count
    FROM (
      SELECT
        event_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${WALLET}'
        AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY side
  `;

  const trades = await clickhouse.query({
    query: tradesQuery,
    format: 'JSONEachRow'
  }).then(r => r.json()) as any[];

  console.table(trades);

  const buys = trades.find(t => t.side.toLowerCase() === 'buy') || { total_usdc: 0, total_tokens: 0, trade_count: 0 };
  const sells = trades.find(t => t.side.toLowerCase() === 'sell') || { total_usdc: 0, total_tokens: 0, trade_count: 0 };

  const buyUsdc = Number(buys.total_usdc);
  const buyTokens = Number(buys.total_tokens);
  const sellUsdc = Number(sells.total_usdc);
  const sellTokens = Number(sells.total_tokens);

  console.log(`\nBuys: $${buyUsdc.toFixed(2)} for ${buyTokens.toFixed(2)} tokens (${buys.trade_count} trades)`);
  console.log(`Sells: $${sellUsdc.toFixed(2)} for ${sellTokens.toFixed(2)} tokens (${sells.trade_count} trades)`);

  // Step 2: Get redemptions
  console.log('\n--- Step 2: Fetching redemptions ---');
  const redemptionsQuery = `
    SELECT
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_redemptions,
      count(*) as redemption_count
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
  `;

  const redemptionsResult = await clickhouse.query({
    query: redemptionsQuery,
    format: 'JSONEachRow'
  }).then(r => r.json()) as any[];

  const redemptions = Number(redemptionsResult[0]?.total_redemptions || 0);
  console.log(`Redemptions: $${redemptions.toFixed(2)}`);

  // Step 3: Calculate token imbalance
  const tokenImbalance = sellTokens - buyTokens;
  console.log(`\nToken Imbalance: ${tokenImbalance.toFixed(2)} (sold ${tokenImbalance > 0 ? 'more' : 'fewer'} than bought)`);

  // Step 4: Try different formulas
  console.log('\n=== TESTING P&L FORMULAS ===\n');

  const formulas: { name: string; calculation: () => number; description: string }[] = [
    {
      name: 'Formula A: Naive CLOB',
      description: 'Sells - Buys + Redemptions',
      calculation: () => sellUsdc - buyUsdc + redemptions
    },
    {
      name: 'Formula B: Token Balance',
      description: 'Consider token imbalance at $1 each',
      calculation: () => sellUsdc - buyUsdc + redemptions - tokenImbalance
    },
    {
      name: 'Formula C: Matched Sells Only',
      description: 'Only count sells up to tokens bought',
      calculation: () => {
        const matchedSellTokens = Math.min(sellTokens, buyTokens);
        const avgSellPrice = sellUsdc / sellTokens;
        const matchedSellUsdc = matchedSellTokens * avgSellPrice;
        return matchedSellUsdc - buyUsdc + redemptions;
      }
    },
    {
      name: 'Formula D: Split Cost Deduction',
      description: 'Subtract $1 for each unmatched token sold',
      calculation: () => {
        const unmatchedTokens = Math.max(0, sellTokens - buyTokens);
        const splitCost = unmatchedTokens; // $1 per split
        return sellUsdc - buyUsdc + redemptions - splitCost;
      }
    },
    {
      name: 'Formula E: Average Price Deduction',
      description: 'Subtract unmatched tokens × avg sell price',
      calculation: () => {
        const unmatchedTokens = Math.max(0, sellTokens - buyTokens);
        const avgSellPrice = sellUsdc / sellTokens;
        return sellUsdc - buyUsdc + redemptions - (unmatchedTokens * avgSellPrice);
      }
    },
    {
      name: 'Formula F: Cash Flow with Splits',
      description: 'Sells + Redemptions - Buys - Splits (where Splits = token imbalance)',
      calculation: () => {
        // Each unmatched token sold came from a $1 split
        const splits = Math.max(0, sellTokens - buyTokens);
        return sellUsdc + redemptions - buyUsdc - splits;
      }
    },
    {
      name: 'Formula G: Net Token Value',
      description: 'Track token flow: each token worth $1 at split',
      calculation: () => {
        // Cash out = Sells + Redemptions
        // Cash in = Buys + Splits (where splits create tokens sold but not bought)
        const cashOut = sellUsdc + redemptions;
        const splits = Math.max(0, sellTokens - buyTokens); // $1 per token split
        const cashIn = buyUsdc + splits;
        return cashOut - cashIn;
      }
    }
  ];

  console.log('| Formula | Result | Diff from Truth | Match? |');
  console.log('|---------|--------|-----------------|--------|');

  for (const formula of formulas) {
    const result = formula.calculation();
    const diff = Math.abs(result - GROUND_TRUTH_PNL);
    const match = diff < 1 ? '✅' : (diff < 10 ? '🟡' : '❌');
    console.log(`| ${formula.name.padEnd(30)} | $${result.toFixed(2).padStart(10)} | $${diff.toFixed(2).padStart(8)} | ${match} |`);
  }

  console.log('\n--- Formula Descriptions ---');
  for (const formula of formulas) {
    console.log(`${formula.name}: ${formula.description}`);
  }

  // Step 5: Deep dive on best matching formulas
  console.log('\n=== DETAILED BREAKDOWN ===\n');

  console.log('Known values:');
  console.log(`  Buy USDC:      $${buyUsdc.toFixed(2)}`);
  console.log(`  Buy Tokens:    ${buyTokens.toFixed(2)}`);
  console.log(`  Sell USDC:     $${sellUsdc.toFixed(2)}`);
  console.log(`  Sell Tokens:   ${sellTokens.toFixed(2)}`);
  console.log(`  Redemptions:   $${redemptions.toFixed(2)}`);
  console.log(`  Token Imbal:   ${tokenImbalance.toFixed(2)}`);

  // Try to solve: what X makes sellUsdc - buyUsdc + redemptions - X = -86?
  const naive = sellUsdc - buyUsdc + redemptions;
  const neededDeduction = naive - GROUND_TRUTH_PNL;
  console.log(`\nNaive P&L: $${naive.toFixed(2)}`);
  console.log(`Need to deduct: $${neededDeduction.toFixed(2)} to get to $${GROUND_TRUTH_PNL}`);

  // What does this deduction represent?
  console.log(`\nPossible interpretations of $${neededDeduction.toFixed(2)} deduction:`);
  console.log(`  As token imbalance: ${(neededDeduction / 1).toFixed(2)} tokens @ $1 each`);
  console.log(`  As avg sell price: ${(neededDeduction / (sellUsdc/sellTokens)).toFixed(2)} tokens @ $${(sellUsdc/sellTokens).toFixed(4)} avg`);
  console.log(`  As avg buy price: ${(neededDeduction / (buyUsdc/buyTokens)).toFixed(2)} tokens @ $${(buyUsdc/buyTokens).toFixed(4)} avg`);

  // Check if the deduction equals the token imbalance
  const tokenImbalanceDeduction = tokenImbalance;
  console.log(`\n  Actual token imbalance: ${tokenImbalance.toFixed(2)}`);
  console.log(`  Difference from needed: $${(neededDeduction - tokenImbalanceDeduction).toFixed(2)}`);

  // Check current balance query
  console.log('\n--- Step 6: Verify with current balance ---');
  const balanceQuery = `
    SELECT
      'USDC deposits to Exchange' as flow_type,
      sum(amount) / 1e6 as usdc
    FROM pm_erc1155_transfers
    WHERE lower(to_address) = '${WALLET}'
      AND token_id = '0'

    UNION ALL

    SELECT
      'USDC withdrawals from Exchange' as flow_type,
      -sum(amount) / 1e6 as usdc
    FROM pm_erc1155_transfers
    WHERE lower(from_address) = '${WALLET}'
      AND token_id = '0'
  `;

  try {
    const balanceResult = await clickhouse.query({
      query: balanceQuery,
      format: 'JSONEachRow'
    }).then(r => r.json()) as any[];
    console.table(balanceResult);
  } catch (e) {
    console.log('Balance query failed (may not have USDC transfers):', (e as Error).message);
  }
}

main().catch(console.error);
