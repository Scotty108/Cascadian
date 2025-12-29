#!/usr/bin/env ts-node
/**
 * Market-level PnL Tracer - Investigate Sign Flip Issue
 *
 * Focus: 0x227c55d09ff49d420fc741c5e301904af62fa303
 * V18: +184.09 vs UI: -278.07 (WRONG SIGN!)
 *
 * This script traces PnL calculation market-by-market to identify where the sign flip occurs.
 */

import { config } from 'dotenv';
import { clickhouse } from '../../lib/clickhouse/client';

// Load environment variables
config({ path: '.env.local' });

const WALLET = '0x227c55d09ff49d420fc741c5e301904af62fa303';

interface MarketPnL {
  condition_id: string;
  outcome_index: number;
  net_shares: number;
  cash_flow: number;
  resolved_price: number;
  computed_pnl: number;
  market_title?: string;
  market_question?: string;
  buy_volume: number;
  sell_volume: number;
  buy_shares: number;
  sell_shares: number;
  is_resolved: boolean;
}

interface TradeDetail {
  event_id: string;
  trade_time: string;
  side: string;
  usdc_amount: number;
  token_amount: number;
  price: number;
  outcome_index: number;
}

interface OutcomeMapping {
  condition_id: string;
  outcome_index: number;
  outcome_name: string;
  payout_numerator: number;
  is_yes_outcome: boolean;
}

async function getMarketPnLBreakdown(): Promise<MarketPnL[]> {
  console.log('\n=== MARKET PNL BREAKDOWN ===\n');

  // Step 1: Get market aggregates
  const aggQuery = `
    WITH
    -- Deduplicated trades with condition mapping
    deduped_trades AS (
      SELECT
        f.event_id,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index,
        any(f.side) as side,
        any(f.usdc_amount) / 1000000.0 as usdc,
        any(f.token_amount) / 1000000.0 as tokens,
        any(f.trade_time) as trade_time,
        any(m.category) as category
      FROM pm_trader_events_dedup_v2_tbl f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower({wallet:String})
      GROUP BY f.event_id
    ),

    -- Calculate per-market metrics
    market_metrics AS (
      SELECT
        condition_id,
        outcome_index,

        -- Buy metrics
        sum(if(side = 'BUY', tokens, 0)) as buy_shares,
        sum(if(side = 'BUY', usdc, 0)) as buy_volume,

        -- Sell metrics
        sum(if(side = 'SELL', tokens, 0)) as sell_shares,
        sum(if(side = 'SELL', usdc, 0)) as sell_volume,

        -- Net position
        sum(if(side = 'BUY', tokens, 0)) - sum(if(side = 'SELL', tokens, 0)) as net_shares,

        -- Cash flow (sell proceeds - buy cost)
        sum(if(side = 'SELL', usdc, 0)) - sum(if(side = 'BUY', usdc, 0)) as cash_flow
      FROM deduped_trades
      GROUP BY condition_id, outcome_index
    ),

    -- Get market metadata
    metadata AS (
      SELECT DISTINCT
        condition_id,
        any(question) as question
      FROM pm_market_metadata
      GROUP BY condition_id
    )

    SELECT
      m.condition_id,
      m.outcome_index,
      m.net_shares,
      m.cash_flow,
      m.buy_volume,
      m.sell_volume,
      m.buy_shares,
      m.sell_shares,
      md.question
    FROM market_metrics m
    LEFT JOIN metadata md ON m.condition_id = md.condition_id
    ORDER BY abs(m.cash_flow) DESC
    LIMIT 10
  `;

  const aggResult = await clickhouse.query({
    query: aggQuery,
    query_params: { wallet: WALLET },
    format: 'JSONEachRow',
  });

  const aggRows = (await aggResult.json()) as any[];

  // Step 2: Get all resolutions
  const resQuery = `
    SELECT condition_id, payout_numerators, resolved_at
    FROM pm_condition_resolutions
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  // Parse payout_numerators from JSON
  const resolutionMap = new Map<string, { payouts: number[]; resolved_at: string | null }>();
  for (const r of resRows) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resolutionMap.set(r.condition_id.toLowerCase(), {
      payouts,
      resolved_at: r.resolved_at,
    });
  }

  // Step 3: Combine and compute PnL
  const results: MarketPnL[] = [];

  for (const agg of aggRows) {
    const conditionId = agg.condition_id.toLowerCase();
    const outcomeIndex = Number(agg.outcome_index);
    const resolution = resolutionMap.get(conditionId);

    let resolved_price = 0;
    let is_resolved = false;

    if (resolution && resolution.payouts.length > outcomeIndex) {
      is_resolved = true;
      resolved_price = resolution.payouts[outcomeIndex];
    }

    const cash_flow = Number(agg.cash_flow);
    const net_shares = Number(agg.net_shares);
    const computed_pnl = cash_flow + net_shares * resolved_price;

    results.push({
      condition_id: agg.condition_id,
      outcome_index: outcomeIndex,
      net_shares,
      cash_flow,
      resolved_price,
      computed_pnl,
      market_question: agg.question || 'Unknown',
      buy_volume: Number(agg.buy_volume),
      sell_volume: Number(agg.sell_volume),
      buy_shares: Number(agg.buy_shares),
      sell_shares: Number(agg.sell_shares),
      is_resolved,
    });
  }

  // Sort by absolute PnL
  results.sort((a, b) => Math.abs(b.computed_pnl) - Math.abs(a.computed_pnl));

  return results;
}

async function getTradeDetails(conditionId: string, outcomeIndex: number): Promise<TradeDetail[]> {
  const query = `
    SELECT
      f.event_id,
      any(f.trade_time) as trade_time,
      any(f.side) as side,
      any(f.usdc_amount) / 1000000.0 as usdc_amount,
      any(f.token_amount) / 1000000.0 as token_amount,
      any(f.usdc_amount) / any(f.token_amount) as price,
      any(m.outcome_index) as outcome_index
    FROM pm_trader_events_dedup_v2_tbl f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower({wallet:String})
      AND lower(m.condition_id) = lower({condition_id:String})
      AND m.outcome_index = {outcome_index:UInt8}
    GROUP BY f.event_id
    ORDER BY trade_time
  `;

  const result = await clickhouse.query({
    query,
    query_params: {
      wallet: WALLET,
      condition_id: conditionId,
      outcome_index: outcomeIndex,
    },
    format: 'JSONEachRow',
  });

  return result.json() as Promise<TradeDetail[]>;
}

async function getOutcomeMapping(conditionId: string): Promise<OutcomeMapping[]> {
  // Get unique outcome indices for this condition
  const mapQuery = `
    SELECT DISTINCT
      condition_id,
      outcome_index
    FROM pm_token_to_condition_map_v5
    WHERE lower(condition_id) = lower({condition_id:String})
    ORDER BY outcome_index
  `;

  const mapResult = await clickhouse.query({
    query: mapQuery,
    query_params: { condition_id: conditionId },
    format: 'JSONEachRow',
  });

  const mapRows = (await mapResult.json()) as any[];

  // Get resolution
  const resQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) = lower({condition_id:String})
      AND is_deleted = 0
    LIMIT 1
  `;

  const resResult = await clickhouse.query({
    query: resQuery,
    query_params: { condition_id: conditionId },
    format: 'JSONEachRow',
  });

  const resRows = (await resResult.json()) as any[];
  const payouts = resRows.length > 0 && resRows[0].payout_numerators
    ? JSON.parse(resRows[0].payout_numerators)
    : [];

  // Combine
  return mapRows.map(row => {
    const idx = Number(row.outcome_index);
    return {
      condition_id: row.condition_id,
      outcome_index: idx,
      outcome_name: idx === 0 ? 'NO' : idx === 1 ? 'YES' : `Outcome ${idx}`,
      payout_numerator: payouts.length > idx ? payouts[idx] : 0,
      is_yes_outcome: idx === 1,
    };
  });
}

async function analyzeWalletPnL() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`PNL SIGN INVESTIGATION - MARKET-LEVEL TRACE`);
  console.log(`${'='.repeat(80)}\n`);
  console.log(`Wallet: ${WALLET}`);
  console.log(`Expected: V18 +184.09 vs UI -278.07 (WRONG SIGN!)\n`);

  const markets = await getMarketPnLBreakdown();

  let totalPnL = 0;
  const findings: string[] = [];

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TOP ${markets.length} MARKETS BY ABSOLUTE PNL`);
  console.log(`${'='.repeat(80)}\n`);

  for (let i = 0; i < Math.min(5, markets.length); i++) {
    const market = markets[i];
    totalPnL += market.computed_pnl;

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`MARKET #${i + 1} - PnL: $${market.computed_pnl.toFixed(2)}`);
    console.log(`${'─'.repeat(80)}\n`);

    console.log(`Condition ID: ${market.condition_id}`);
    console.log(`Outcome Index: ${market.outcome_index}`);
    console.log(`Question: ${market.market_question || 'N/A'}\n`);

    // Get outcome mapping
    const outcomes = await getOutcomeMapping(market.condition_id);
    const thisOutcome = outcomes.find(o => o.outcome_index === market.outcome_index);

    console.log(`OUTCOME DETAILS:`);
    console.log(`  Bet on outcome: ${thisOutcome?.outcome_name || 'Unknown'}`);
    console.log(`  Is YES outcome: ${thisOutcome?.is_yes_outcome ? 'YES' : 'NO'}`);
    console.log(`  Resolution price: $${market.resolved_price.toFixed(6)}`);
    console.log(`  Resolved: ${market.is_resolved ? 'YES' : 'NO'}\n`);

    if (outcomes.length > 0) {
      console.log(`ALL OUTCOMES FOR THIS MARKET:`);
      outcomes.forEach(o => {
        console.log(`  [${o.outcome_index}] ${o.outcome_name}: payout=${o.payout_numerator.toFixed(6)} (${o.is_yes_outcome ? 'YES' : 'NO'})`);
      });
      console.log();
    }

    console.log(`POSITION DETAILS:`);
    console.log(`  Buy Volume:   $${market.buy_volume.toFixed(2)} (${market.buy_shares.toFixed(2)} shares)`);
    console.log(`  Sell Volume:  $${market.sell_volume.toFixed(2)} (${market.sell_shares.toFixed(2)} shares)`);
    console.log(`  Net Shares:   ${market.net_shares.toFixed(2)}`);
    console.log(`  Cash Flow:    $${market.cash_flow.toFixed(2)} (sell_proceeds - buy_cost)\n`);

    console.log(`PNL CALCULATION:`);
    console.log(`  Formula: cash_flow + (net_shares * resolved_price)`);
    console.log(`  = ${market.cash_flow.toFixed(2)} + (${market.net_shares.toFixed(2)} * ${market.resolved_price.toFixed(6)})`);
    console.log(`  = ${market.cash_flow.toFixed(2)} + ${(market.net_shares * market.resolved_price).toFixed(2)}`);
    console.log(`  = $${market.computed_pnl.toFixed(2)}\n`);

    // Analyze for issues
    const issues: string[] = [];

    // Check cash flow sign
    if (market.buy_volume > 0 && market.sell_volume === 0 && market.cash_flow > 0) {
      issues.push('⚠️  ISSUE: Positive cash flow with only buys (should be negative)');
    }
    if (market.sell_volume > 0 && market.buy_volume === 0 && market.cash_flow < 0) {
      issues.push('⚠️  ISSUE: Negative cash flow with only sells (should be positive)');
    }

    // Check if net_shares and resolution don't make sense
    if (market.is_resolved && market.net_shares > 0 && market.resolved_price === 0) {
      issues.push('⚠️  ISSUE: Holding shares in losing outcome (shares > 0, price = 0)');
    }

    // Check for YES/NO confusion
    if (thisOutcome && market.resolved_price === 1 && !thisOutcome.is_yes_outcome) {
      issues.push('⚠️  POSSIBLE ISSUE: Outcome shows payout=1 but is_yes_outcome=false');
    }
    if (thisOutcome && market.resolved_price === 0 && thisOutcome.is_yes_outcome) {
      issues.push('⚠️  POSSIBLE ISSUE: Outcome shows payout=0 but is_yes_outcome=true');
    }

    if (issues.length > 0) {
      console.log(`POTENTIAL ISSUES:`);
      issues.forEach(issue => console.log(`  ${issue}`));
      console.log();
      findings.push(...issues.map(i => `Market ${i + 1} (${market.condition_id.slice(0, 8)}...): ${i}`));
    }

    // Get trade details for top 3 markets
    if (i < 3) {
      const trades = await getTradeDetails(market.condition_id, market.outcome_index);

      if (trades.length > 0) {
        console.log(`TRADE HISTORY (${trades.length} trades):`);
        console.log(`  Time                  | Side | Shares    | USDC      | Price   `);
        console.log(`  ${'-'.repeat(70)}`);

        trades.forEach(t => {
          const side = t.side.padEnd(4);
          const shares = t.token_amount.toFixed(2).padStart(9);
          const usdc = t.usdc_amount.toFixed(2).padStart(9);
          const price = t.price.toFixed(4).padStart(7);
          console.log(`  ${t.trade_time} | ${side} | ${shares} | ${usdc} | ${price}`);
        });
        console.log();
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);
  console.log(`Total markets analyzed: ${markets.length}`);
  console.log(`Sum of top ${Math.min(5, markets.length)} market PnLs: $${totalPnL.toFixed(2)}`);
  console.log(`Expected V18 PnL: $184.09`);
  console.log(`Expected UI PnL: -$278.07\n`);

  if (findings.length > 0) {
    console.log(`FINDINGS (${findings.length} issues):`);
    findings.forEach(f => console.log(`  - ${f}`));
    console.log();
  }

  // Check overall pattern
  console.log(`PATTERN ANALYSIS:`);

  const allResolved = markets.filter(m => m.is_resolved);
  const withPositiveCashFlow = markets.filter(m => m.cash_flow > 0);
  const withNegativeCashFlow = markets.filter(m => m.cash_flow < 0);
  const withPositivePnL = markets.filter(m => m.computed_pnl > 0);
  const withNegativePnL = markets.filter(m => m.computed_pnl < 0);

  console.log(`  Resolved markets: ${allResolved.length}/${markets.length}`);
  console.log(`  Markets with positive cash flow: ${withPositiveCashFlow.length}`);
  console.log(`  Markets with negative cash flow: ${withNegativeCashFlow.length}`);
  console.log(`  Markets with positive PnL: ${withPositivePnL.length}`);
  console.log(`  Markets with negative PnL: ${withNegativePnL.length}\n`);

  // Sign flip hypothesis
  if (Math.abs(totalPnL - 184.09) < 10) {
    console.log(`✓ Sum matches V18 (+184.09) - formula appears correct`);
  } else if (Math.abs(totalPnL + 278.07) < 10) {
    console.log(`⚠️  Sum matches UI negated (+278.07) - likely sign flip in formula`);
  } else if (Math.abs(-totalPnL - 278.07) < 10) {
    console.log(`⚠️  Negated sum matches UI (-278.07) - entire formula may be inverted`);
  } else {
    console.log(`❌ Sum doesn't match either value - formula may have multiple issues`);
  }

  return { markets, totalPnL, findings };
}

async function generateReport(data: { markets: MarketPnL[], totalPnL: number, findings: string[] }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const reportPath = `/Users/scotty/Projects/Cascadian-app/docs/reports/WRONG_SIGN_INVESTIGATION_${timestamp}.md`;

  let report = `# PnL Sign Flip Investigation
**Generated:** ${new Date().toISOString()}
**Wallet:** ${WALLET}
**Issue:** V18 reports +$184.09, UI reports -$278.07 (wrong sign!)

---

## Executive Summary

Analyzed top ${data.markets.length} markets by absolute PnL contribution.

**Key Findings:**
- Total PnL from top 5 markets: $${data.totalPnL.toFixed(2)}
- Expected V18: +$184.09
- Expected UI: -$278.07
- Deviation from V18: $${Math.abs(data.totalPnL - 184.09).toFixed(2)}
- Deviation from UI negated: $${Math.abs(data.totalPnL + 278.07).toFixed(2)}

`;

  if (data.findings.length > 0) {
    report += `**Issues Found:** ${data.findings.length}\n`;
    data.findings.forEach(f => {
      report += `- ${f}\n`;
    });
    report += `\n`;
  }

  report += `---

## Market-by-Market Breakdown

`;

  for (let i = 0; i < Math.min(5, data.markets.length); i++) {
    const m = data.markets[i];
    const outcomes = await getOutcomeMapping(m.condition_id);
    const thisOutcome = outcomes.find(o => o.outcome_index === m.outcome_index);

    report += `### Market #${i + 1}: ${m.market_question || 'Unknown'}

**Condition ID:** \`${m.condition_id}\`
**Outcome Index:** ${m.outcome_index} (${thisOutcome?.outcome_name || 'Unknown'})
**Computed PnL:** $${m.computed_pnl.toFixed(2)}

**Position:**
- Buy: $${m.buy_volume.toFixed(2)} (${m.buy_shares.toFixed(2)} shares)
- Sell: $${m.sell_volume.toFixed(2)} (${m.sell_shares.toFixed(2)} shares)
- Net Shares: ${m.net_shares.toFixed(2)}
- Cash Flow: $${m.cash_flow.toFixed(2)}

**Resolution:**
- Resolved: ${m.is_resolved ? 'YES' : 'NO'}
- Resolution Price: $${m.resolved_price.toFixed(6)}

**Calculation:**
\`\`\`
cash_flow + (net_shares * resolved_price)
= ${m.cash_flow.toFixed(2)} + (${m.net_shares.toFixed(2)} * ${m.resolved_price.toFixed(6)})
= ${m.cash_flow.toFixed(2)} + ${(m.net_shares * m.resolved_price).toFixed(2)}
= $${m.computed_pnl.toFixed(2)}
\`\`\`

**Outcome Mapping:**
`;

    outcomes.forEach(o => {
      report += `- [${o.outcome_index}] ${o.outcome_name}: payout=${o.payout_numerator.toFixed(6)} (${o.is_yes_outcome ? 'YES' : 'NO'})\n`;
    });

    report += `\n---\n\n`;
  }

  report += `## Analysis

### Cash Flow Sign Check
- **Expected:** BUY = negative cash flow (money out), SELL = positive cash flow (money in)
- **Formula:** cash_flow = sell_proceeds - buy_cost

`;

  const buysOnly = data.markets.filter(m => m.buy_volume > 0 && m.sell_volume === 0);
  const sellsOnly = data.markets.filter(m => m.sell_volume > 0 && m.buy_volume === 0);

  if (buysOnly.length > 0) {
    report += `**Markets with only buys (${buysOnly.length}):**\n`;
    buysOnly.slice(0, 3).forEach(m => {
      const expectedCF = -m.buy_volume;
      const match = Math.abs(m.cash_flow - expectedCF) < 0.01 ? '✓' : '✗';
      report += `- ${match} Condition ${m.condition_id.slice(0, 8)}... CF=${m.cash_flow.toFixed(2)} (expected ${expectedCF.toFixed(2)})\n`;
    });
    report += `\n`;
  }

  if (sellsOnly.length > 0) {
    report += `**Markets with only sells (${sellsOnly.length}):**\n`;
    sellsOnly.slice(0, 3).forEach(m => {
      const expectedCF = m.sell_volume;
      const match = Math.abs(m.cash_flow - expectedCF) < 0.01 ? '✓' : '✗';
      report += `- ${match} Condition ${m.condition_id.slice(0, 8)}... CF=${m.cash_flow.toFixed(2)} (expected ${expectedCF.toFixed(2)})\n`;
    });
    report += `\n`;
  }

  report += `### Outcome Indexing Check
- **Question:** Does outcome_index=0 mean YES or NO?
- **Question:** Does payout_numerators[0] correspond to YES or NO?
- **Question:** Is there an off-by-one error or YES/NO flip?

`;

  const resolved = data.markets.filter(m => m.is_resolved);
  if (resolved.length > 0) {
    report += `**Sample resolved markets:**\n`;
    for (const m of resolved.slice(0, 3)) {
      const outcomes = await getOutcomeMapping(m.condition_id);
      report += `\nCondition ${m.condition_id.slice(0, 8)}... (outcome_index=${m.outcome_index}):\n`;
      outcomes.forEach(o => {
        const star = o.outcome_index === m.outcome_index ? '→' : ' ';
        report += `  ${star} [${o.outcome_index}] ${o.outcome_name}: payout=${o.payout_numerator.toFixed(2)}\n`;
      });
    }
    report += `\n`;
  }

  report += `### Formula Comparison

**Our formula (V18):**
\`\`\`
PnL = cash_flow + (net_shares * resolved_price)
where:
  cash_flow = sell_proceeds - buy_cost
  net_shares = buy_shares - sell_shares
\`\`\`

**Possible UI formula:**
\`\`\`
PnL = Gain - Loss
where:
  Gain = sell_proceeds + (remaining_shares * current_price)
  Loss = buy_cost
\`\`\`

**Hypothesis:** The UI may be using a different accounting method that produces opposite signs.

`;

  report += `## Recommended Next Steps

1. **Verify cash flow calculation:**
   - Check if buy/sell sides are correctly assigned
   - Confirm sell_proceeds - buy_cost formula is correct

2. **Check outcome indexing:**
   - Verify payout_numerators array alignment
   - Confirm outcome_index maps correctly to YES/NO

3. **Compare formulas:**
   - Test if UI uses (Gain - Loss) vs our (cash_flow + shares*price)
   - Check if there's a sign inversion in the base formula

4. **Validate with known market:**
   - Pick a simple resolved market with 1 buy + 1 sell
   - Manually calculate PnL both ways
   - Compare with UI and V18 output

---

**Generated by:** \`scripts/pnl/trace-market-pnl.ts\`
`;

  const fs = await import('fs/promises');
  await fs.writeFile(reportPath, report);
  console.log(`\n✓ Report written to: ${reportPath}\n`);

  return reportPath;
}

async function main() {
  try {
    const data = await analyzeWalletPnL();
    await generateReport(data);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`INVESTIGATION COMPLETE`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

main();
