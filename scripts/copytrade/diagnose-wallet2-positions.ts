/**
 * Diagnose wallet #2 unredeemed positions
 *
 * Goal: Understand why UI shows $893,352 but we calculated $1,227,565
 * The ~$334,000 discrepancy likely comes from unredeemed losing positions
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function diagnose() {
  const wallet = '0x006cc834cc092684f1b56626e23bedb3835c16ea';

  console.log('=== Diagnosing Wallet #2 Position Discrepancy ===\n');
  console.log(`Wallet: ${wallet}`);
  console.log('UI shows: $893,352');
  console.log('We calculated: $1,227,565');
  console.log('Discrepancy: ~$334,000\n');

  // Get all positions for this wallet with their resolution status
  const query = `
    SELECT
      p.condition_id,
      p.outcome_index,
      p.cash_flow,
      p.final_tokens,
      r.resolution_price,
      r.resolution_price IS NOT NULL AS is_resolved,
      CASE WHEN r.resolution_price IS NOT NULL
        THEN p.cash_flow + (p.final_tokens * r.resolution_price)
        ELSE NULL
      END AS realized_pnl
    FROM (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = '${wallet}'
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    ) AS p
    LEFT JOIN (
      SELECT condition_id, outcome_index, any(resolved_price) AS resolution_price
      FROM vw_pm_resolution_prices
      GROUP BY condition_id, outcome_index
    ) AS r ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
    ORDER BY p.cash_flow ASC
    LIMIT 200
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const positions = await result.json() as any[];

  console.log('Total positions fetched:', positions.length);

  // Summary stats
  let totalResolved = 0;
  let totalUnresolved = 0;
  let resolvedPnl = 0;
  let unresolvedCashFlow = 0;
  let unresolvedTokens = 0;
  let resolvedWithTokens = 0;

  const unresolvedPositions: any[] = [];
  const resolvedZeroPositions: any[] = [];

  for (const p of positions) {
    const cashFlow = Number(p.cash_flow);
    const finalTokens = Number(p.final_tokens);
    const resolutionPrice = p.resolution_price !== null ? Number(p.resolution_price) : null;

    if (p.is_resolved) {
      totalResolved++;
      resolvedPnl += Number(p.realized_pnl);

      // Check for resolved to 0 positions (losers)
      if (resolutionPrice === 0 && finalTokens > 0) {
        resolvedZeroPositions.push({
          condition_id: p.condition_id,
          cash_flow: cashFlow,
          final_tokens: finalTokens,
          realized_pnl: Number(p.realized_pnl),
        });
      }

      // Positions resolved but still holding tokens (unredeemed)
      if (finalTokens > 1) {
        resolvedWithTokens++;
      }
    } else {
      totalUnresolved++;
      unresolvedCashFlow += cashFlow;
      unresolvedTokens += finalTokens;

      if (finalTokens > 0 && cashFlow < -1000) {
        unresolvedPositions.push({
          condition_id: p.condition_id,
          outcome_index: p.outcome_index,
          cash_flow: cashFlow,
          final_tokens: finalTokens,
        });
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Resolved positions: ${totalResolved}`);
  console.log(`Unresolved positions: ${totalUnresolved}`);
  console.log(`Resolved PnL (what we count): $${resolvedPnl.toLocaleString()}`);
  console.log(`Unresolved cash flow: $${unresolvedCashFlow.toLocaleString()}`);
  console.log(`Unresolved tokens held: ${unresolvedTokens.toLocaleString()}`);
  console.log(`Resolved positions with tokens > 1: ${resolvedWithTokens}`);

  console.log('\n=== TOP 20 UNRESOLVED POSITIONS (by cash outflow) ===');
  console.log('These are positions where we spent money but market not resolved in our data:');
  unresolvedPositions.sort((a, b) => a.cash_flow - b.cash_flow);
  for (const p of unresolvedPositions.slice(0, 20)) {
    console.log(`  ${p.condition_id.slice(0, 16)}... | outcome ${p.outcome_index} | cash: $${p.cash_flow.toLocaleString()} | tokens: ${p.final_tokens.toLocaleString()}`);
  }

  console.log('\n=== RESOLVED TO 0 POSITIONS (losers with tokens) ===');
  console.log('These ARE being counted as losses:');
  let totalZeroLosses = 0;
  for (const p of resolvedZeroPositions.slice(0, 20)) {
    totalZeroLosses += p.realized_pnl;
    console.log(`  ${p.condition_id.slice(0, 16)}... | PnL: $${p.realized_pnl.toLocaleString()} | tokens: ${p.final_tokens.toLocaleString()}`);
  }
  console.log(`Total resolved-to-0 losses counted: $${totalZeroLosses.toLocaleString()}`);

  // Key insight: The unresolved positions with negative cash flow
  // If these resolved to 0, that would be additional losses not counted
  const potentialHiddenLosses = unresolvedPositions
    .filter(p => p.cash_flow < 0)
    .reduce((sum, p) => sum + Math.abs(p.cash_flow), 0);

  console.log('\n=== POTENTIAL HIDDEN LOSSES ===');
  console.log(`If all unresolved negative cash flow resolved to 0: $${potentialHiddenLosses.toLocaleString()}`);
  console.log('This could explain the $334k discrepancy');

  // Let's check what these condition_ids correspond to
  if (unresolvedPositions.length > 0) {
    console.log('\n=== Looking up market names for unresolved positions ===');
    const conditionIds = unresolvedPositions.slice(0, 10).map(p => `'${p.condition_id}'`).join(',');

    const marketQuery = `
      SELECT condition_id, question, end_date_iso
      FROM pm_market_metadata
      WHERE condition_id IN (${conditionIds})
    `;

    try {
      const marketResult = await ch.query({ query: marketQuery, format: 'JSONEachRow' });
      const markets = await marketResult.json() as any[];

      for (const m of markets) {
        const pos = unresolvedPositions.find(p => p.condition_id === m.condition_id);
        if (pos) {
          console.log(`  ${m.question?.slice(0, 60) || 'Unknown'}...`);
          console.log(`    End: ${m.end_date_iso} | Cash: $${pos.cash_flow.toLocaleString()}`);
        }
      }
    } catch (e) {
      console.log('  Could not fetch market names');
    }
  }

  await ch.close();
}

diagnose().catch(console.error);
