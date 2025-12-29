/**
 * CTF Cash + Token Evolution Debugger
 *
 * For CTF-heavy wallets with large PnL errors, this script traces
 * the step-by-step cash and token evolution per condition_id to understand
 * how PositionSplit, PositionsMerge, and PayoutRedemption affect PnL.
 *
 * Goal: Propose a consistent canonical inclusion rule for CTF events.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

const CLASSIFICATION_FILE = 'data/wallet-classification-report.json';
const REPORT_FILE = 'data/v18-benchmark-report.json';

// Wallets with significant CTF activity and large PnL errors (from benchmark file)
const CTF_HEAVY_WALLETS = [
  { wallet: '0x9291310143ba48e37646add06624792a6ba34b99', name: 'comic11', uiPnl: 2.41, v6Err: 2489 },
  { wallet: '0x6a8ab02581be2c9ba3cdb59eeba25a481ee38a70', name: '0x6a8AB...', uiPnl: 261.88, v6Err: 236 },
  { wallet: '0x8d74bc5d0da9a78e69f4262b21e46061f7e90ac4', name: '0x8D74Bc...', uiPnl: -47.38, v6Err: 130 },
];

interface LedgerEvent {
  source_type: string;
  event_time: Date;
  event_id: string;
  condition_id: string;
  outcome_index: number;
  usdc_delta: number;
  token_delta: number;
  payout_norm: number | null;
}

async function getWalletEvents(wallet: string): Promise<LedgerEvent[]> {
  const query = `
    SELECT
      source_type,
      event_time,
      event_id,
      condition_id,
      outcome_index,
      usdc_delta,
      token_delta,
      payout_norm
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
    ORDER BY event_time, event_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    source_type: r.source_type,
    event_time: new Date(r.event_time),
    event_id: r.event_id,
    condition_id: r.condition_id,
    outcome_index: Number(r.outcome_index),
    usdc_delta: Number(r.usdc_delta),
    token_delta: Number(r.token_delta),
    payout_norm: r.payout_norm !== null ? Number(r.payout_norm) : null,
  }));
}

async function getConditionDetails(conditionId: string): Promise<{ resolved: boolean; payoutNumerators: string | null }> {
  const query = `
    SELECT payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id = '${conditionId}'
    LIMIT 1
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) {
    return { resolved: false, payoutNumerators: null };
  }
  return { resolved: true, payoutNumerators: rows[0].payout_numerators };
}

function formatUSD(val: number): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}$${val.toFixed(2)}`;
}

function formatTokens(val: number): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(4)}t`;
}

async function debugWallet(walletInfo: { wallet: string; name: string; uiPnl: number; v6Err: number }) {
  console.log('');
  console.log('='.repeat(120));
  console.log(`WALLET: ${walletInfo.name} (${walletInfo.wallet.substring(0, 10)}...)`);
  console.log(`UI PnL: $${walletInfo.uiPnl.toFixed(2)}, V6 CLOB-only Error: ${walletInfo.v6Err.toFixed(0)}%`);
  console.log('='.repeat(120));

  const events = await getWalletEvents(walletInfo.wallet);
  console.log(`Total events in unified ledger v6: ${events.length}`);

  // Count by source type
  const bySource: Record<string, number> = {};
  for (const e of events) {
    bySource[e.source_type] = (bySource[e.source_type] || 0) + 1;
  }
  console.log('Events by source:', bySource);

  // Group events by condition_id
  const byCondition: Map<string, LedgerEvent[]> = new Map();
  for (const e of events) {
    const key = e.condition_id;
    if (!byCondition.has(key)) {
      byCondition.set(key, []);
    }
    byCondition.get(key)!.push(e);
  }

  console.log(`Unique conditions: ${byCondition.size}`);
  console.log('');

  // Find conditions with CTF events (not just CLOB)
  const conditionsWithCtf: string[] = [];
  for (const [condId, condEvents] of byCondition) {
    const hasCtf = condEvents.some((e) => e.source_type !== 'CLOB');
    if (hasCtf) {
      conditionsWithCtf.push(condId);
    }
  }

  console.log(`Conditions with CTF events: ${conditionsWithCtf.length}`);
  console.log('');

  // Detailed trace for up to 3 conditions with CTF events
  let tracedCount = 0;
  for (const condId of conditionsWithCtf.slice(0, 5)) {
    const condEvents = byCondition.get(condId)!;
    const details = await getConditionDetails(condId);

    console.log('-'.repeat(120));
    console.log(`CONDITION: ${condId.substring(0, 20)}...`);
    console.log(`Resolved: ${details.resolved}, Payout Numerators: ${details.payoutNumerators || 'N/A'}`);
    console.log('');

    // Track running balances per outcome_index
    const balances: Map<number, { cash: number; tokens: number }> = new Map();

    console.log('EVENT TIMELINE:');
    console.log('Time                | Source           | Idx | USDC Delta   | Token Delta   | Running Cash | Running Tokens');
    console.log('-'.repeat(120));

    for (const e of condEvents.sort((a, b) => a.event_time.getTime() - b.event_time.getTime())) {
      if (!balances.has(e.outcome_index)) {
        balances.set(e.outcome_index, { cash: 0, tokens: 0 });
      }
      const bal = balances.get(e.outcome_index)!;
      bal.cash += e.usdc_delta;
      bal.tokens += e.token_delta;

      const time = e.event_time.toISOString().substring(0, 19);
      console.log(
        `${time} | ${e.source_type.padEnd(16)} | ${String(e.outcome_index).padStart(3)} | ` +
          `${formatUSD(e.usdc_delta).padStart(12)} | ${formatTokens(e.token_delta).padStart(13)} | ` +
          `${formatUSD(bal.cash).padStart(12)} | ${formatTokens(bal.tokens).padStart(14)}`
      );
    }

    console.log('');
    console.log('FINAL POSITION SUMMARY:');
    let totalCash = 0;
    let totalTokenPnl = 0;
    for (const [idx, bal] of balances) {
      // Get resolution price for this outcome
      let resPrice = 0;
      if (details.payoutNumerators) {
        try {
          const payouts = JSON.parse(details.payoutNumerators);
          const payout = payouts[idx] || 0;
          resPrice = payout >= 1000 ? 1 : payout;
        } catch {
          resPrice = 0;
        }
      }
      const tokenPnl = bal.tokens * resPrice;
      const posPnl = bal.cash + tokenPnl;
      totalCash += bal.cash;
      totalTokenPnl += tokenPnl;

      console.log(
        `  Outcome ${idx}: Cash=${formatUSD(bal.cash)}, Tokens=${bal.tokens.toFixed(4)}, ` +
          `ResPrice=${resPrice}, TokenPnL=${formatUSD(tokenPnl)}, PosPnL=${formatUSD(posPnl)}`
      );
    }
    console.log(`  TOTAL: Cash=${formatUSD(totalCash)}, TokenPnL=${formatUSD(totalTokenPnl)}, Total=${formatUSD(totalCash + totalTokenPnl)}`);
    console.log('');

    tracedCount++;
  }

  // Summary calculation with different source combinations
  console.log('='.repeat(120));
  console.log('PNL CALCULATION VARIANTS');
  console.log('='.repeat(120));

  const variants = [
    { name: 'CLOB only', sources: ['CLOB'] },
    { name: 'CLOB + PayoutRedemption', sources: ['CLOB', 'PayoutRedemption'] },
    { name: 'CLOB + Redemption + Merge', sources: ['CLOB', 'PayoutRedemption', 'PositionsMerge'] },
    { name: 'All sources', sources: ['CLOB', 'PayoutRedemption', 'PositionsMerge', 'PositionSplit'] },
  ];

  for (const variant of variants) {
    let totalPnl = 0;

    for (const [condId, condEvents] of byCondition) {
      const details = await getConditionDetails(condId);

      // Filter events by source
      const filtered = condEvents.filter((e) => variant.sources.includes(e.source_type));

      // Aggregate per outcome
      const balances: Map<number, { cash: number; tokens: number }> = new Map();
      for (const e of filtered) {
        if (!balances.has(e.outcome_index)) {
          balances.set(e.outcome_index, { cash: 0, tokens: 0 });
        }
        const bal = balances.get(e.outcome_index)!;
        bal.cash += e.usdc_delta;
        bal.tokens += e.token_delta;
      }

      // Calculate PnL per outcome
      for (const [idx, bal] of balances) {
        let resPrice = 0;
        if (details.payoutNumerators) {
          try {
            const payouts = JSON.parse(details.payoutNumerators);
            const payout = payouts[idx] || 0;
            resPrice = payout >= 1000 ? 1 : payout;
          } catch {
            resPrice = 0;
          }
        }
        totalPnl += bal.cash + bal.tokens * resPrice;
      }
    }

    const error = walletInfo.uiPnl !== 0 ? Math.abs((totalPnl - walletInfo.uiPnl) / walletInfo.uiPnl) * 100 : 0;
    console.log(`${variant.name.padEnd(30)}: $${totalPnl.toFixed(2).padStart(10)} | Error: ${error.toFixed(1)}%`);
  }
}

async function main() {
  console.log('CTF CASH + TOKEN EVOLUTION DEBUGGER');
  console.log('Goal: Understand CTF event semantics and propose canonical inclusion rules');
  console.log('');

  for (const walletInfo of CTF_HEAVY_WALLETS) {
    await debugWallet(walletInfo);
  }

  console.log('');
  console.log('='.repeat(120));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(120));
  console.log('');
  console.log('Key Questions:');
  console.log('1. Are PositionSplit events double-counting cost basis already in CLOB?');
  console.log('2. Are PayoutRedemption events necessary to capture winning payouts?');
  console.log('3. Are PositionsMerge events providing cash inflows not in CLOB?');
  console.log('4. What is the correct canonical formula for CTF-heavy wallets?');
}

main().catch(console.error);
