/**
 * Deep Analysis of ImJustKen's Position Lifecycle
 *
 * UI shows: $2,436,163.50 profit
 * Current V9 calculation: -$24,769,856 (WRONG!)
 *
 * Hypothesis: PositionsMerge is being misinterpreted
 * - PositionsMerge: Converting complete token sets back to USDC (NOT profit)
 * - It's a neutral operation that should cancel out with corresponding PositionSplit
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x9d84ce0306f8551e02efef1680475fc0f1dc1344'; // ImJustKen
const UI_PNL = 2436163.50;

async function main() {
  console.log('='.repeat(120));
  console.log('DEEP ANALYSIS: ImJustKen');
  console.log('='.repeat(120));
  console.log(`Wallet: ${WALLET}`);
  console.log(`UI PnL: $${UI_PNL.toLocaleString()}`);
  console.log('');

  // 1. Summary by source type (both CLOB sides separately)
  console.log('STEP 1: Summary by Source Type and Role/Side');
  console.log('-'.repeat(120));

  const summaryQuery = `
    SELECT
      source_type,
      sum(usdc_delta) as total_usdc,
      sum(token_delta) as total_tokens,
      count() as events
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
    GROUP BY source_type
    ORDER BY total_usdc DESC
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summaryRows = (await summaryResult.json()) as any[];

  let totalUsdc = 0;
  let totalTokens = 0;
  console.log('Source              | USDC Total          | Token Total         | Events');
  console.log('-'.repeat(120));
  for (const r of summaryRows) {
    const usdc = Number(r.total_usdc);
    const tokens = Number(r.total_tokens);
    totalUsdc += usdc;
    totalTokens += tokens;
    console.log(
      `${r.source_type.padEnd(18)} | $${usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(18)} | ${tokens.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(18)} | ${r.events}`
    );
  }
  console.log('-'.repeat(120));
  console.log(`TOTAL               | $${totalUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(18)} | ${totalTokens.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(18)}`);
  console.log('');

  // 2. Check CLOB by role and side separately
  console.log('STEP 2: CLOB Trades Breakdown (from pm_trader_events_v2)');
  console.log('-'.repeat(120));

  const clobDetailQuery = `
    SELECT
      role,
      side,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as total_usdc,
      sum(token_amount) / 1e6 as total_tokens
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
    GROUP BY role, side
    ORDER BY role, side
  `;

  const clobResult = await clickhouse.query({ query: clobDetailQuery, format: 'JSONEachRow' });
  const clobRows = (await clobResult.json()) as any[];

  console.log('Role   | Side | Trades      | USDC Volume         | Token Volume');
  console.log('-'.repeat(120));
  for (const r of clobRows) {
    console.log(
      `${r.role.padEnd(6)} | ${r.side.padEnd(4)} | ${Number(r.trade_count).toLocaleString().padStart(11)} | $${Number(r.total_usdc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(18)} | ${Number(r.total_tokens).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(18)}`
    );
  }
  console.log('');

  // 3. Try multiple formula approaches
  console.log('STEP 3: Formula Approaches Comparison');
  console.log('-'.repeat(120));

  // Approach A: Simple sum(usdc_delta) from unified ledger v9
  const approachAQuery = `
    SELECT sum(usdc_delta) as pnl
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
  `;
  const aResult = await clickhouse.query({ query: approachAQuery, format: 'JSONEachRow' });
  const aRows = (await aResult.json()) as any[];
  const approachA = Number(aRows[0]?.pnl || 0);

  // Approach B: Only CLOB + PayoutRedemption (exclude Split/Merge)
  const approachBQuery = `
    SELECT sum(usdc_delta) as pnl
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type IN ('CLOB', 'PayoutRedemption')
  `;
  const bResult = await clickhouse.query({ query: approachBQuery, format: 'JSONEachRow' });
  const bRows = (await bResult.json()) as any[];
  const approachB = Number(bRows[0]?.pnl || 0);

  // Approach C: CLOB only (no CTF events at all)
  const approachCQuery = `
    SELECT sum(usdc_delta) as pnl
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'CLOB'
  `;
  const cResult = await clickhouse.query({ query: approachCQuery, format: 'JSONEachRow' });
  const cRows = (await cResult.json()) as any[];
  const approachC = Number(cRows[0]?.pnl || 0);

  // Approach D: PayoutRedemption only
  const approachDQuery = `
    SELECT sum(usdc_delta) as pnl
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'PayoutRedemption'
  `;
  const dResult = await clickhouse.query({ query: approachDQuery, format: 'JSONEachRow' });
  const dRows = (await dResult.json()) as any[];
  const approachD = Number(dRows[0]?.pnl || 0);

  // Approach E: Split/Merge net (should be ~0 if balanced)
  const approachEQuery = `
    SELECT sum(usdc_delta) as pnl
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type IN ('PositionSplit', 'PositionsMerge')
  `;
  const eResult = await clickhouse.query({ query: approachEQuery, format: 'JSONEachRow' });
  const eRows = (await eResult.json()) as any[];
  const approachE = Number(eRows[0]?.pnl || 0);

  // Approach F: From pm_trader_events directly (maker buys - maker sells + taker buys - taker sells)
  const approachFQuery = `
    SELECT
      sumIf(usdc_amount, role = 'maker' AND side = 'sell') / 1e6
      - sumIf(usdc_amount, role = 'maker' AND side = 'buy') / 1e6
      + sumIf(usdc_amount, role = 'taker' AND side = 'sell') / 1e6
      - sumIf(usdc_amount, role = 'taker' AND side = 'buy') / 1e6
      as pnl
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
  `;
  const fResult = await clickhouse.query({ query: approachFQuery, format: 'JSONEachRow' });
  const fRows = (await fResult.json()) as any[];
  const approachF = Number(fRows[0]?.pnl || 0);

  // Approach G: Only PayoutRedemption (realized gains from resolved markets)
  const approachGQuery = `
    SELECT sum(usdc_delta) as pnl
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'PayoutRedemption'
  `;
  const gResult = await clickhouse.query({ query: approachGQuery, format: 'JSONEachRow' });
  const gRows = (await gResult.json()) as any[];
  const approachG = Number(gRows[0]?.pnl || 0);

  const formatPnl = (pnl: number) => {
    const err = UI_PNL !== 0 ? ((Math.abs(pnl - UI_PNL) / Math.abs(UI_PNL)) * 100).toFixed(1) : 'N/A';
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}$${pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${err}% err)`;
  };

  console.log(`UI Target:                          +$${UI_PNL.toLocaleString()}`);
  console.log('');
  console.log(`A. All sources sum(usdc_delta):     ${formatPnl(approachA)}`);
  console.log(`B. CLOB + PayoutRedemption only:    ${formatPnl(approachB)}`);
  console.log(`C. CLOB only:                       ${formatPnl(approachC)}`);
  console.log(`D. PayoutRedemption only:           ${formatPnl(approachD)}`);
  console.log(`E. Split/Merge net:                 ${formatPnl(approachE)}`);
  console.log(`F. Direct from trader_events:       ${formatPnl(approachF)}`);
  console.log('');

  // 4. Check if Split/Merge should cancel out
  console.log('STEP 4: Position Split/Merge Balance by Market');
  console.log('-'.repeat(120));

  const splitMergeQuery = `
    SELECT
      canonical_condition_id,
      sumIf(usdc_delta, source_type = 'PositionSplit') as split_usdc,
      sumIf(usdc_delta, source_type = 'PositionsMerge') as merge_usdc,
      sumIf(usdc_delta, source_type = 'PositionSplit') + sumIf(usdc_delta, source_type = 'PositionsMerge') as net
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type IN ('PositionSplit', 'PositionsMerge')
    GROUP BY canonical_condition_id
    HAVING abs(net) > 1000
    ORDER BY abs(net) DESC
    LIMIT 20
  `;

  const smResult = await clickhouse.query({ query: splitMergeQuery, format: 'JSONEachRow' });
  const smRows = (await smResult.json()) as any[];

  if (smRows.length > 0) {
    console.log('Markets with unbalanced Split/Merge (|net| > $1000):');
    console.log('Condition ID (first 30)                | Split USDC       | Merge USDC       | Net');
    console.log('-'.repeat(120));
    for (const r of smRows) {
      const condId = (r.canonical_condition_id || 'NULL').substring(0, 30).padEnd(30);
      const split = Number(r.split_usdc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
      const merge = Number(r.merge_usdc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
      const net = Number(r.net).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
      console.log(`${condId} | $${split} | $${merge} | $${net}`);
    }
  } else {
    console.log('All Split/Merge operations are balanced (net ≈ 0)');
  }
  console.log('');

  // 5. Check what approach works for wallets that PASSED the benchmark
  console.log('STEP 5: What makes ImJustKen different from wallets that passed?');
  console.log('-'.repeat(120));

  // Get ratio of PositionsMerge to total activity
  const ratioQuery = `
    SELECT
      sumIf(abs(usdc_delta), source_type = 'PositionsMerge') as merge_volume,
      sumIf(abs(usdc_delta), source_type = 'CLOB') as clob_volume,
      sumIf(abs(usdc_delta), source_type = 'PayoutRedemption') as redemption_volume,
      sumIf(abs(usdc_delta), source_type = 'PositionSplit') as split_volume,
      sum(abs(usdc_delta)) as total_volume
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
  `;
  const ratioResult = await clickhouse.query({ query: ratioQuery, format: 'JSONEachRow' });
  const ratioRows = (await ratioResult.json()) as any[];
  const ratio = ratioRows[0];

  console.log('Volume by source type:');
  console.log(`  CLOB:             $${Number(ratio.clob_volume).toLocaleString()}`);
  console.log(`  PayoutRedemption: $${Number(ratio.redemption_volume).toLocaleString()}`);
  console.log(`  PositionsMerge:   $${Number(ratio.merge_volume).toLocaleString()}`);
  console.log(`  PositionSplit:    $${Number(ratio.split_volume).toLocaleString()}`);
  console.log(`  Total:            $${Number(ratio.total_volume).toLocaleString()}`);
  console.log('');
  console.log('Ratios:');
  console.log(`  Merge/Total:      ${((Number(ratio.merge_volume) / Number(ratio.total_volume)) * 100).toFixed(1)}%`);
  console.log(`  Split/Total:      ${((Number(ratio.split_volume) / Number(ratio.total_volume)) * 100).toFixed(1)}%`);
  console.log(`  (Split+Merge)/Total: ${(((Number(ratio.merge_volume) + Number(ratio.split_volume)) / Number(ratio.total_volume)) * 100).toFixed(1)}%`);
  console.log('');

  // 6. Key hypothesis test: CLOB PnL + PayoutRedemption (no Split/Merge)
  console.log('STEP 6: Key Hypothesis - The Correct PnL Formula');
  console.log('-'.repeat(120));
  console.log('');
  console.log('The issue: PositionsMerge/Split are CASH-FLOW events, not PnL events.');
  console.log('');
  console.log('When you split $100 into YES+NO tokens, you get -$100 usdc_delta but own $100 of tokens.');
  console.log('When you merge YES+NO tokens back, you get +$100 usdc_delta but lose $100 of tokens.');
  console.log('NET PnL from Split/Merge = $0 (it is a conversion, not profit)');
  console.log('');
  console.log('True PnL should come from:');
  console.log('  1. CLOB trading: Buy low, sell high');
  console.log('  2. PayoutRedemption: Winning tokens redeemed at resolution');
  console.log('');
  console.log('BUT the V20 formula ONLY counts CLOB and ignores PayoutRedemption...');
  console.log('');

  // Check the actual V20 formula vs the correct approach
  const v20Query = `
    WITH
      positions AS (
        SELECT
          canonical_condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'CLOB'
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY canonical_condition_id, outcome_index
      ),
      position_pnl AS (
        SELECT
          canonical_condition_id,
          cash_flow,
          final_tokens,
          resolution_price,
          if(resolution_price IS NOT NULL,
             round(cash_flow + final_tokens * resolution_price, 2),
             0) AS pos_realized_pnl,
          if(resolution_price IS NULL,
             round(cash_flow + final_tokens * 0.5, 2),
             0) AS pos_unrealized_pnl
        FROM positions
      )
    SELECT
      sum(pos_realized_pnl) AS realized_pnl,
      sum(pos_unrealized_pnl) AS unrealized_pnl,
      sum(pos_realized_pnl) + sum(pos_unrealized_pnl) AS total_pnl
    FROM position_pnl
  `;
  const v20Result = await clickhouse.query({ query: v20Query, format: 'JSONEachRow' });
  const v20Rows = (await v20Result.json()) as any[];
  const v20Pnl = Number(v20Rows[0]?.total_pnl || 0);

  console.log(`V20 formula (CLOB only + resolution_price): ${formatPnl(v20Pnl)}`);
  console.log('');
  console.log('This misses PayoutRedemption entirely!');
  console.log(`PayoutRedemption alone = ${formatPnl(approachD)}`);
  console.log('');
  console.log('If we add CLOB net + PayoutRedemption:');
  const clobPlusRedemption = approachC + approachD;
  console.log(`  CLOB net ($${approachC.toLocaleString()}) + PayoutRedemption ($${approachD.toLocaleString()}) = ${formatPnl(clobPlusRedemption)}`);
  console.log('');

  // 7. Final check: What if we use a purely position-based approach?
  console.log('STEP 7: Alternative Position-Based Approach');
  console.log('-'.repeat(120));

  // For each market, calculate: tokens_acquired_via_clob * resolution_price - cost_paid_via_clob
  const posBasedQuery = `
    WITH clob_positions AS (
      SELECT
        canonical_condition_id,
        outcome_index,
        sum(usdc_delta) as cash_spent,
        sum(token_delta) as tokens_net,
        any(payout_norm) as resolution
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'CLOB'
        AND canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
      GROUP BY canonical_condition_id, outcome_index
    )
    SELECT
      sum(if(resolution IS NOT NULL, cash_spent + tokens_net * resolution, 0)) as realized,
      sum(if(resolution IS NULL, cash_spent + tokens_net * 0.5, 0)) as unrealized,
      count() as positions
    FROM clob_positions
  `;
  const posResult = await clickhouse.query({ query: posBasedQuery, format: 'JSONEachRow' });
  const posRows = (await posResult.json()) as any[];
  const posBased = posRows[0];

  console.log(`Position-based (CLOB only):`);
  console.log(`  Realized:   ${formatPnl(Number(posBased.realized))}`);
  console.log(`  Unrealized: ${formatPnl(Number(posBased.unrealized))}`);
  console.log(`  Positions:  ${posBased.positions}`);
  console.log('');

  console.log('='.repeat(120));
  console.log('CONCLUSION');
  console.log('='.repeat(120));
  console.log('');
  console.log('The V20/V21 formula only looks at CLOB trades and applies resolution_price to');
  console.log('final token balances. This MISSES PayoutRedemption events entirely!');
  console.log('');
  console.log('For ImJustKen:');
  console.log(`  - CLOB net cash flow: $${approachC.toLocaleString()}`);
  console.log(`  - PayoutRedemption:   $${approachD.toLocaleString()}`);
  console.log(`  - Split/Merge net:    $${approachE.toLocaleString()} (should be excluded from PnL)`);
  console.log('');
  console.log('The correct formula should be:');
  console.log('  1. For resolved markets: Cash from CLOB trades + PayoutRedemption received');
  console.log('  2. For unresolved: Cash from CLOB + (final_tokens * mark_price)');
  console.log('');
  console.log('OR simply: sum(usdc_delta) for CLOB + PayoutRedemption sources only');
}

main().catch(console.error);
