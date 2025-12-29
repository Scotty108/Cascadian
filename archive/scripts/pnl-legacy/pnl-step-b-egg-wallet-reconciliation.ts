#!/usr/bin/env tsx

/**
 * PnL TDD Validation - Step B: Single-Wallet Full Reconciliation
 * 
 * Target: Egg wallet (0xcce2b7c71f21e358b8e5e797e586cbc03160d58b)
 * Goal: Full reconciliation against UI reference data
 * 
 * Known Discrepancies:
 * - Below $4.50 May: -$15,101.59 gap (36%)
 * - More than $6 March: -$25,528.83 gap (100% missing)
 * - $3.25-3.50 August: +$1,021.53 gap (17% over)
 * - $3.25-3.50 July: +$4,034.67 gap (71% over)
 */

import { clickhouse } from '../lib/clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const EGG_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface MarketPnL {
  condition_id: string;
  question: string;
  is_resolved: number;
  total_trades: number;
  trade_cash: number;
  resolution_value: number;
  realized_pnl: number;
}

interface OutcomeDetail {
  outcome_index: number;
  cash_delta: number;
  final_shares: number;
  resolved_price: number;
  trade_count: number;
}

interface UIReference {
  name: string;
  ui_pnl: number;
  search_terms: string[];
}

const UI_REFERENCES: UIReference[] = [
  { 
    name: "Below $4.50 May", 
    ui_pnl: 41289.47,
    search_terms: ['$4.50', 'May', 'egg']
  },
  { 
    name: "More than $6 March", 
    ui_pnl: 25528.83,
    search_terms: ['$6', 'March', 'egg']
  },
  { 
    name: "$3.25-3.50 August", 
    ui_pnl: 5925.46,
    search_terms: ['$3.25', '$3.50', 'August', 'egg']
  },
  { 
    name: "$3.25-3.50 July", 
    ui_pnl: 5637.10,
    search_terms: ['$3.25', '$3.50', 'July', 'egg']
  }
];

async function main() {
  console.log('='.repeat(80));
  console.log('PnL TDD VALIDATION - STEP B: EGG WALLET FULL RECONCILIATION');
  console.log('='.repeat(80));
  console.log(`\nTarget Wallet: ${EGG_WALLET}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  // ============================================================================
  // TASK 1: GET ALL RESOLVED MARKETS WITH PNL
  // ============================================================================
  console.log('TASK 1: Fetching all resolved markets for egg wallet...\n');

  const allMarketsQuery = `
    WITH per_outcome AS (
        SELECT
            t.trader_wallet as wallet_address,
            m.condition_id,
            m.question,
            m.outcome_index,
            sum(CASE WHEN lower(t.side) = 'buy'
                     THEN -(t.usdc_amount / 1000000.0)
                     ELSE +(t.usdc_amount / 1000000.0) END) as cash_delta,
            sum(CASE WHEN lower(t.side) = 'buy'
                     THEN +(t.token_amount / 1000000.0)
                     ELSE -(t.token_amount / 1000000.0) END) as final_shares,
            count(*) as trade_count
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE t.trader_wallet = '${EGG_WALLET}'
        GROUP BY t.trader_wallet, m.condition_id, m.question, m.outcome_index
    ),
    with_resolution AS (
        SELECT
            p.*,
            r.payout_numerators,
            CASE
                WHEN r.condition_id IS NOT NULL AND r.payout_numerators != '' AND r.payout_numerators IS NOT NULL
                THEN toFloat64OrZero(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', ''))[p.outcome_index + 1])
                ELSE 0
            END as resolved_price,
            r.condition_id IS NOT NULL as is_resolved
        FROM per_outcome p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
    )
    SELECT
        condition_id,
        any(question) as question,
        is_resolved,
        sum(trade_count) as total_trades,
        sum(cash_delta) as trade_cash,
        sum(final_shares * resolved_price) as resolution_value,
        sum(cash_delta) + sum(final_shares * resolved_price) as realized_pnl
    FROM with_resolution
    GROUP BY condition_id, is_resolved
    ORDER BY realized_pnl DESC
  `;

  const allMarkets = await clickhouse.query({
    query: allMarketsQuery,
    format: 'JSONEachRow'
  });

  const markets: MarketPnL[] = await allMarkets.json();

  // ============================================================================
  // TASK 2: CALCULATE WALLET TOTALS
  // ============================================================================
  console.log('TASK 2: Calculating wallet totals...\n');

  const resolvedMarkets = markets.filter(m => m.is_resolved === 1);
  const unresolvedMarkets = markets.filter(m => m.is_resolved === 0);

  const totalResolvedPnL = resolvedMarkets.reduce((sum, m) => sum + m.realized_pnl, 0);
  const totalUnrealizedValue = unresolvedMarkets.reduce((sum, m) => sum + m.trade_cash, 0);

  console.log('WALLET TOTALS:');
  console.log('─'.repeat(80));
  console.log(`Resolved Markets: ${resolvedMarkets.length}`);
  console.log(`Total Resolved PnL: $${totalResolvedPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`\nUnresolved Markets: ${unresolvedMarkets.length}`);
  console.log(`Total Unrealized (cash deployed): $${totalUnrealizedValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`\nTotal Markets: ${markets.length}`);
  console.log('─'.repeat(80));

  // Show top 10 resolved markets
  console.log('\nTOP 10 RESOLVED MARKETS BY PnL:');
  console.log('─'.repeat(80));
  resolvedMarkets.slice(0, 10).forEach((m, i) => {
    console.log(`${i + 1}. ${m.question.substring(0, 60)}...`);
    console.log(`   Condition: ${m.condition_id}`);
    console.log(`   PnL: $${m.realized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Trades: ${m.total_trades}`);
    console.log('');
  });

  // ============================================================================
  // TASK 3: DETAILED BREAKDOWN OF 4 KNOWN DISCREPANCY MARKETS
  // ============================================================================
  console.log('\nTASK 3: Analyzing 4 known discrepancy markets...\n');

  for (const ref of UI_REFERENCES) {
    console.log('='.repeat(80));
    console.log(`ANALYZING: ${ref.name}`);
    console.log(`UI Expected PnL: $${ref.ui_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('─'.repeat(80));

    // Find matching market(s)
    const matchingMarkets = markets.filter(m => {
      const q = m.question.toLowerCase();
      return ref.search_terms.every(term => q.includes(term.toLowerCase()));
    });

    if (matchingMarkets.length === 0) {
      console.log('❌ NO MATCHING MARKET FOUND');
      console.log(`   Search terms: ${ref.search_terms.join(', ')}`);
      console.log('');
      
      // Check if market exists at all
      const marketExistsQuery = `
        SELECT DISTINCT
            m.condition_id,
            m.question,
            count(*) as total_trades_all_wallets
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE ${ref.search_terms.map(term => `lower(m.question) LIKE '%${term.toLowerCase()}%'`).join(' AND ')}
        GROUP BY m.condition_id, m.question
      `;
      
      const existsResult = await clickhouse.query({
        query: marketExistsQuery,
        format: 'JSONEachRow'
      });
      
      const existingMarkets = await existsResult.json();
      
      if (existingMarkets.length > 0) {
        console.log('   ⚠️  Market EXISTS in database but NO TRADES for egg wallet:');
        existingMarkets.forEach((em: any) => {
          console.log(`      - ${em.question}`);
          console.log(`        Condition: ${em.condition_id}`);
          console.log(`        Total trades (all wallets): ${em.total_trades_all_wallets}`);
        });
      } else {
        console.log('   ⚠️  Market does NOT EXIST in database at all');
      }
      
      continue;
    }

    for (const market of matchingMarkets) {
      console.log(`\n✓ Found Match: ${market.question}`);
      console.log(`  Condition ID: ${market.condition_id}`);
      console.log(`  Our PnL: $${market.realized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log(`  Gap: $${(ref.ui_pnl - market.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${((Math.abs(ref.ui_pnl - market.realized_pnl) / ref.ui_pnl) * 100).toFixed(1)}%)`);
      console.log(`  Resolved: ${market.is_resolved === 1 ? 'Yes' : 'No'}`);
      console.log(`  Total Trades: ${market.total_trades}`);

      // Get per-outcome breakdown
      const outcomeQuery = `
        WITH per_outcome AS (
            SELECT
                m.condition_id,
                m.outcome_index,
                sum(CASE WHEN lower(t.side) = 'buy'
                         THEN -(t.usdc_amount / 1000000.0)
                         ELSE +(t.usdc_amount / 1000000.0) END) as cash_delta,
                sum(CASE WHEN lower(t.side) = 'buy'
                         THEN +(t.token_amount / 1000000.0)
                         ELSE -(t.token_amount / 1000000.0) END) as final_shares,
                count(*) as trade_count
            FROM pm_trader_events_v2 t
            JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
            WHERE t.trader_wallet = '${EGG_WALLET}'
              AND m.condition_id = '${market.condition_id}'
            GROUP BY m.condition_id, m.outcome_index
        )
        SELECT
            p.outcome_index,
            p.cash_delta,
            p.final_shares,
            p.trade_count,
            CASE
                WHEN r.condition_id IS NOT NULL AND r.payout_numerators != '' AND r.payout_numerators IS NOT NULL
                THEN toFloat64OrZero(splitByChar(',', replaceAll(replaceAll(r.payout_numerators, '[', ''), ']', ''))[p.outcome_index + 1])
                ELSE 0
            END as resolved_price
        FROM per_outcome p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
        ORDER BY p.outcome_index
      `;

      const outcomeResult = await clickhouse.query({
        query: outcomeQuery,
        format: 'JSONEachRow'
      });

      const outcomes: OutcomeDetail[] = await outcomeResult.json();

      console.log('\n  Per-Outcome Breakdown:');
      console.log('  ' + '─'.repeat(76));
      console.log('  Outcome | Trades | Cash Delta    | Final Shares  | Price | Value');
      console.log('  ' + '─'.repeat(76));
      
      outcomes.forEach(o => {
        const value = o.final_shares * o.resolved_price;
        console.log(`  ${o.outcome_index.toString().padStart(7)} | ${o.trade_count.toString().padStart(6)} | $${o.cash_delta.toFixed(2).padStart(12)} | ${o.final_shares.toFixed(4).padStart(13)} | ${o.resolved_price.toFixed(2).padStart(5)} | $${value.toFixed(2).padStart(10)}`);
      });

      const totalCash = outcomes.reduce((sum, o) => sum + o.cash_delta, 0);
      const totalValue = outcomes.reduce((sum, o) => sum + (o.final_shares * o.resolved_price), 0);
      const calculatedPnL = totalCash + totalValue;

      console.log('  ' + '─'.repeat(76));
      console.log(`  TOTALS: Trade Cash: $${totalCash.toFixed(2)}, Resolution Value: $${totalValue.toFixed(2)}, PnL: $${calculatedPnL.toFixed(2)}`);
    }

    console.log('');
  }

  // ============================================================================
  // TASK 5: CATEGORIZE EACH DISCREPANCY
  // ============================================================================
  console.log('\n' + '='.repeat(80));
  console.log('TASK 5: DISCREPANCY CATEGORIZATION');
  console.log('='.repeat(80) + '\n');

  interface DiscrepancyAnalysis {
    market: string;
    ui_pnl: number;
    our_pnl: number;
    gap: number;
    gap_pct: number;
    flag: string;
    explanation: string;
  }

  const analyses: DiscrepancyAnalysis[] = [];

  for (const ref of UI_REFERENCES) {
    const matchingMarkets = markets.filter(m => {
      const q = m.question.toLowerCase();
      return ref.search_terms.every(term => q.includes(term.toLowerCase()));
    });

    let our_pnl = 0;
    let flag = 'UNKNOWN';
    let explanation = '';

    if (matchingMarkets.length === 0) {
      flag = 'MISSING_TRADES';
      explanation = '100% gap - no trades found for this wallet in this market';
    } else {
      our_pnl = matchingMarkets.reduce((sum, m) => sum + m.realized_pnl, 0);
      const gap_pct = Math.abs((ref.ui_pnl - our_pnl) / ref.ui_pnl) * 100;

      if (gap_pct < 1) {
        flag = 'MATCH';
        explanation = 'Within 1% tolerance';
      } else if (our_pnl > ref.ui_pnl) {
        flag = 'OVER_REPORTED';
        explanation = 'Our PnL exceeds UI expectation';
      } else if (gap_pct === 100) {
        flag = 'MISSING_TRADES';
        explanation = '100% gap - market found but no egg wallet trades';
      } else {
        flag = 'PARTIAL_TRADES';
        explanation = `${gap_pct.toFixed(1)}% gap - some trades may be missing`;
      }
    }

    const gap = ref.ui_pnl - our_pnl;
    const gap_pct = Math.abs(gap / ref.ui_pnl) * 100;

    analyses.push({
      market: ref.name,
      ui_pnl: ref.ui_pnl,
      our_pnl,
      gap,
      gap_pct,
      flag,
      explanation
    });

    console.log(`${ref.name}:`);
    console.log(`  UI PnL:     $${ref.ui_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Our PnL:    $${our_pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Gap:        $${gap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${gap_pct.toFixed(1)}%)`);
    console.log(`  Flag:       ${flag}`);
    console.log(`  Reason:     ${explanation}`);
    console.log('');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80) + '\n');

  const totalUIExpected = UI_REFERENCES.reduce((sum, ref) => sum + ref.ui_pnl, 0);
  const totalOurPnL = analyses.reduce((sum, a) => sum + a.our_pnl, 0);
  const totalGap = totalUIExpected - totalOurPnL;

  console.log('Known Discrepancy Markets (4 markets):');
  console.log(`  UI Expected:    $${totalUIExpected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Our Calculated: $${totalOurPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Gap:            $${totalGap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');

  console.log('Overall Wallet:');
  console.log(`  Total Resolved PnL:    $${totalResolvedPnL.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  UI Expectation (~):    $96,000.00`);
  console.log(`  Difference:            $${(96000 - totalResolvedPnL).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');

  console.log('Data Quality Flags:');
  const flagCounts = analyses.reduce((acc, a) => {
    acc[a.flag] = (acc[a.flag] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  Object.entries(flagCounts).forEach(([flag, count]) => {
    console.log(`  ${flag}: ${count} market(s)`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('END OF RECONCILIATION');
  console.log('='.repeat(80));
}

main().catch(console.error);
