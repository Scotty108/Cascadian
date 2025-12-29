/**
 * Debug Remaining Discrepancy for Smart Money 1
 *
 * After applying NegRisk/CLOB dedup, we went from -$3.5M to -$1.2M
 * but UI shows +$332K. Still a ~$1.5M gap.
 *
 * Let's examine what's going on.
 */

import { createV13Engine } from '../../lib/pnl/uiActivityEngineV13';
import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('='.repeat(80));
  console.log('DEBUG REMAINING DISCREPANCY');
  console.log('='.repeat(80));

  const engine = createV13Engine();
  const result = await engine.compute(WALLET);

  console.log('\n=== V13 SUMMARY ===');
  console.log(`  CLOB Trades:    ${result.clob_trades.toLocaleString()}`);
  console.log(`  NegRisk Acq:    ${result.negrisk_acquisitions.toLocaleString()}`);
  console.log(`  CTF Splits:     ${result.ctf_splits.toLocaleString()}`);
  console.log(`  CTF Merges:     ${result.ctf_merges.toLocaleString()}`);
  console.log(`  Resolutions:    ${result.resolutions.toLocaleString()}`);
  console.log(`  Realized PnL:   $${result.realized_pnl.toLocaleString()}`);

  // Check what trades were included vs excluded
  console.log('\n=== DEDUP ANALYSIS ===');

  // Get raw CLOB count (before dedup)
  const rawClobQuery = `
    SELECT count() as total, countDistinct(event_id) as unique_events
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
  `;
  const rawClobResult = await clickhouse.query({ query: rawClobQuery, format: 'JSONEachRow' });
  const rawClob = (await rawClobResult.json()) as any[];
  console.log(`  Raw CLOB rows: ${rawClob[0]?.total} (${rawClob[0]?.unique_events} unique)`);

  // Get raw NegRisk count
  const rawNegriskQuery = `
    SELECT count() as total
    FROM vw_negrisk_conversions
    WHERE lower(wallet) = lower('${WALLET}')
  `;
  const rawNegriskResult = await clickhouse.query({ query: rawNegriskQuery, format: 'JSONEachRow' });
  const rawNegrisk = (await rawNegriskResult.json()) as any[];
  console.log(`  Raw NegRisk entries: ${rawNegrisk[0]?.total}`);

  // V13 included
  console.log(`  V13 CLOB: ${result.clob_trades} (deduped + excluded NegRisk overlaps)`);
  console.log(`  V13 NegRisk: ${result.negrisk_acquisitions}`);

  // Check the top 5 winning and losing positions
  const sortedPos = [...result.positions].sort((a, b) => a.realized_pnl - b.realized_pnl);

  console.log('\n=== TOP 5 LOSERS ===');
  for (let i = 0; i < 5; i++) {
    const p = sortedPos[i];
    console.log(`  ${p.condition_id.substring(0, 16)}... idx=${p.outcome_index} | PnL: $${p.realized_pnl.toLocaleString()} | Resolved: ${p.is_resolved} | Payout: $${p.resolution_payout}`);
  }

  console.log('\n=== TOP 5 WINNERS ===');
  const winners = sortedPos.slice(-5).reverse();
  for (const p of winners) {
    console.log(`  ${p.condition_id.substring(0, 16)}... idx=${p.outcome_index} | PnL: $${p.realized_pnl.toLocaleString()} | Resolved: ${p.is_resolved} | Payout: $${p.resolution_payout}`);
  }

  // Check Polymarket API to see what they report
  console.log('\n=== POLYMARKET DATA API CHECK ===');
  try {
    const profileUrl = `https://data-api.polymarket.com/profile?address=${WALLET}`;
    console.log(`  Fetching: ${profileUrl}`);

    const response = await fetch(profileUrl);
    if (response.ok) {
      const profile = await response.json();
      console.log(`  API profit_loss_pct: ${profile.profit_loss_pct}`);
      console.log(`  API volume: ${profile.volume}`);
    } else {
      console.log(`  API returned: ${response.status}`);
    }
  } catch (err) {
    console.log(`  API error: ${(err as Error).message}`);
  }

  // The key question: is the issue in resolution handling, cost basis, or token counting?
  console.log('\n=== DETAILED LOSS ANALYSIS ===');

  // Count how many positions are resolved
  const resolved = result.positions.filter(p => p.is_resolved);
  const unresolved = result.positions.filter(p => !p.is_resolved);
  console.log(`  Resolved positions: ${resolved.length}`);
  console.log(`  Unresolved positions: ${unresolved.length}`);

  // Sum PnL by resolution status
  const resolvedPnl = resolved.reduce((s, p) => s + p.realized_pnl, 0);
  const unresolvedPnl = unresolved.reduce((s, p) => s + p.realized_pnl, 0);
  console.log(`  Resolved PnL: $${resolvedPnl.toLocaleString()}`);
  console.log(`  Unresolved PnL: $${unresolvedPnl.toLocaleString()}`);

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
