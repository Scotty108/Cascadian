/**
 * Test-Driven PnL Calculation for Known-Good Wallet
 *
 * Wallet: 0xf918977ef9d3f101385eda508621d5f835fa9052
 * Owner confirmed PnL: $1.16
 *
 * UI Closed Positions (6 markets, all Won):
 * 1. Elon 300-319 (Nov 21-28): 5.4 No at 92¢ → $5.00 bet → $5.44 won → +$0.44
 * 2. Polymarket US 2025: 1.3 Yes at 78¢ → $1.00 bet → $1.27 won → +$0.27
 * 3. Elon 300-319 (Nov 25-Dec 2): 2.4 No at 83¢ → $2.00 bet → $2.18 won → +$0.18
 * 4. Elon 320-339 (Nov 21-28): 3.1 No at 96¢ → $3.00 bet → $3.11 won → +$0.11
 * 5. Elon 280-299 (Nov 21-28): 3.9 Yes at 97¢ → $3.81 bet → $3.91 won → +$0.10
 * 6. Elon 220-239 (Nov 21-28): 1.1 No at 95¢ → $1.00 bet → $1.05 won → +$0.05
 *
 * TOTAL: $1.15 (UI shows $1.16 due to cent-rounding accumulation)
 *
 * Rounding Note (from GoldSky):
 * The UI rounds prices to cents BEFORE multiplication. Over multiple trades,
 * this causes ~$0.01 drift vs full-precision calculations. This is expected.
 *
 * Key Discoveries:
 * 1. pm_trader_events_v3 contains both maker AND taker rows for the same fill
 *    when wallet is on both sides (bundled splits, self-trades)
 * 2. Dedupe by (tx_hash, outcome, side) using MAX(tokens) and MAX(usdc)
 *    to capture full fill amounts from maker rows
 * 3. For bundled splits (buy+sell different outcomes same tx):
 *    - Only count buy cost as the investment
 *    - Disposal sell of unwanted outcome is NOT cash received
 * 4. For pure sells (exit position before resolution):
 *    - Count sell cash as realized proceeds
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';
const EXPECTED_PNL = 1.16;

interface PositionResult {
  question: string;
  outcome: number;
  bought: number;
  sold: number;
  net_tokens: number;
  cost: number;
  sell_cash: number;
  payout: number;
  settlement: number;
  pnl: number;
}

async function calculatePnL(): Promise<{
  positions: PositionResult[];
  totalPnL: number;
}> {
  // V3 PnL with MAX-based deduplication to handle maker+taker duplicates
  const query = `
    WITH deduped_trades AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        -- Use MAX to get full fill amount (maker row has aggregate, taker rows are partials)
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = lower('${WALLET}')
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY tx_hash, m.condition_id, m.outcome_index, m.question, t.side
    ),
    tx_summary AS (
      SELECT
        tx_hash,
        condition_id,
        any(question) as question,
        sumIf(usdc, side = 'buy') as buy_usdc,
        sumIf(tokens, side = 'buy') as buy_tokens,
        argMaxIf(outcome_index, tokens, side = 'buy') as buy_outcome,
        sumIf(usdc, side = 'sell') as sell_usdc,
        sumIf(tokens, side = 'sell') as sell_tokens,
        countDistinctIf(outcome_index, side = 'buy') as buy_outcomes,
        countDistinctIf(outcome_index, side = 'sell') as sell_outcomes
      FROM deduped_trades
      GROUP BY tx_hash, condition_id
    ),
    tx_flows AS (
      SELECT *,
        -- Bundled split: buy and sell touch different outcomes in same tx
        (buy_outcomes > 0 AND sell_outcomes > 0 AND buy_tokens > 0) as is_bundled,
        -- For pure sells (no buy in same tx), count the cash received
        CASE WHEN buy_usdc = 0 THEN sell_usdc ELSE 0 END as realized_cash,
        CASE WHEN buy_usdc = 0 THEN sell_tokens ELSE 0 END as tokens_realized
      FROM tx_summary
    ),
    market_totals AS (
      SELECT
        condition_id,
        any(question) as question,
        argMax(buy_outcome, buy_tokens) as outcome,
        sum(buy_tokens) as total_bought,
        sum(buy_usdc) as total_cost,
        sum(realized_cash) as total_sell_cash,
        sum(tokens_realized) as total_sold
      FROM tx_flows
      GROUP BY condition_id
    )
    SELECT
      question,
      outcome,
      round(total_bought, 4) as bought,
      round(total_sold, 4) as sold,
      round(total_bought - total_sold, 4) as net_tokens,
      round(total_cost, 4) as cost,
      round(total_sell_cash, 4) as sell_cash,
      arrayElement(r.norm_prices, toUInt8(outcome + 1)) as payout,
      round((total_bought - total_sold) * arrayElement(r.norm_prices, toUInt8(outcome + 1)), 4) as settlement,
      -- UI-style: round(won, 2) - round(bet, 2)
      round(total_sell_cash + ((total_bought - total_sold) * arrayElement(r.norm_prices, toUInt8(outcome + 1))), 2)
        - round(total_cost, 2) as pnl
    FROM market_totals m
    LEFT JOIN pm_condition_resolutions_norm r ON lower(m.condition_id) = lower(r.condition_id)
    WHERE length(r.norm_prices) > 0
    ORDER BY question
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const positions: PositionResult[] = rows.map(r => ({
    question: r.question,
    outcome: Number(r.outcome),
    bought: Number(r.bought),
    sold: Number(r.sold),
    net_tokens: Number(r.net_tokens),
    cost: Number(r.cost),
    sell_cash: Number(r.sell_cash),
    payout: Number(r.payout),
    settlement: Number(r.settlement),
    pnl: Number(r.pnl),
  }));

  const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);

  return { positions, totalPnL };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  PnL Test: Known-Good Wallet                                      ║');
  console.log('║  Using pm_trader_events_v3 with MAX-based deduplication           ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  console.log(`Wallet: ${WALLET}`);
  console.log(`Expected PnL (from UI): $${EXPECTED_PNL.toFixed(2)}\n`);

  const { positions, totalPnL } = await calculatePnL();

  console.log('Positions by Market:');
  console.log('─'.repeat(105));
  console.log(
    'Market'.padEnd(50),
    'Out'.padStart(3),
    'Bought'.padStart(8),
    'Sold'.padStart(8),
    'Net'.padStart(8),
    'Cost'.padStart(8),
    'SellCash'.padStart(8),
    'PnL'.padStart(8)
  );
  console.log('─'.repeat(105));

  for (const p of positions) {
    const shortQ = p.question.length > 48 ? p.question.slice(0, 45) + '...' : p.question;
    console.log(
      shortQ.padEnd(50),
      p.outcome.toString().padStart(3),
      p.bought.toFixed(2).padStart(8),
      p.sold.toFixed(2).padStart(8),
      p.net_tokens.toFixed(2).padStart(8),
      `$${p.cost.toFixed(2)}`.padStart(8),
      `$${p.sell_cash.toFixed(2)}`.padStart(8),
      `$${p.pnl.toFixed(2)}`.padStart(8)
    );
  }

  console.log('─'.repeat(105));
  console.log('\nSummary:');
  console.log(`  Calculated PnL: $${totalPnL.toFixed(2)}`);
  console.log(`  Expected PnL:   $${EXPECTED_PNL.toFixed(2)}`);

  const delta = totalPnL - EXPECTED_PNL;
  const deltaPct = (delta / EXPECTED_PNL * 100);
  console.log(`  Delta:          ${delta >= 0 ? '+' : ''}$${delta.toFixed(2)} (${deltaPct.toFixed(1)}%)`);

  // Test assertion
  const tolerance = 0.10; // 10 cents tolerance
  if (Math.abs(delta) <= tolerance) {
    console.log('\n✅ TEST PASSED: PnL matches within $0.10 tolerance');
  } else {
    console.log('\n❌ TEST FAILED: PnL does not match');
    console.log(`   Delta of $${Math.abs(delta).toFixed(2)} exceeds $${tolerance.toFixed(2)} tolerance`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
