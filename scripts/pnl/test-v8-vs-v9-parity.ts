/**
 * V8 vs V9 Ledger Parity Test
 *
 * Compares PnL calculations between:
 * - V8 unified ledger (CLOB + CTF events)
 * - V9 CLOB-only ledger (no CTF split/merge/redemption)
 *
 * For CLOB_ONLY wallets (no CTF activity), the results should be identical.
 * For MIXED wallets, V9 will be missing CTF events.
 *
 * Usage:
 *   npx tsx scripts/pnl/test-v8-vs-v9-parity.ts <wallet>
 *   npx tsx scripts/pnl/test-v8-vs-v9-parity.ts --sample 10
 */

import { calculateV29PnL, evaluateTraderStrict, V29Result } from '../../lib/pnl/inventoryEngineV29';
import { clickhouse } from '../../lib/clickhouse/client';

interface ParityResult {
  wallet: string;
  v8: V29Result;
  v9: V29Result;
  delta: {
    realizedPnl: number;
    unrealizedPnl: number;
    uiParityPnl: number;
    eventsProcessed: number;
    openPositions: number;
  };
  percentDiff: {
    realizedPnl: number;
    uiParityPnl: number;
  };
  walletType: string;
  isClobOnly: boolean;
  isPerfectMatch: boolean;
}

async function calculateParity(wallet: string): Promise<ParityResult> {
  // Calculate with V8 (unified)
  const v8 = await calculateV29PnL(wallet, {
    inventoryGuard: true,
    valuationMode: 'ui',
    ledgerSource: 'v8_unified',
  });

  // Calculate with V9 (CLOB-only)
  const v9 = await calculateV29PnL(wallet, {
    inventoryGuard: true,
    valuationMode: 'ui',
    ledgerSource: 'v9_clob_only',
  });

  const eligibility = evaluateTraderStrict(v8);
  const isClobOnly = eligibility.walletTypeBadge === 'CLOB_ONLY';

  const delta = {
    realizedPnl: v9.realizedPnl - v8.realizedPnl,
    unrealizedPnl: v9.unrealizedPnl - v8.unrealizedPnl,
    uiParityPnl: v9.uiParityPnl - v8.uiParityPnl,
    eventsProcessed: v9.eventsProcessed - v8.eventsProcessed,
    openPositions: v9.openPositions - v8.openPositions,
  };

  const percentDiff = {
    realizedPnl: v8.realizedPnl !== 0 ? (delta.realizedPnl / Math.abs(v8.realizedPnl)) * 100 : 0,
    uiParityPnl: v8.uiParityPnl !== 0 ? (delta.uiParityPnl / Math.abs(v8.uiParityPnl)) * 100 : 0,
  };

  const isPerfectMatch =
    Math.abs(delta.realizedPnl) < 0.01 &&
    Math.abs(delta.uiParityPnl) < 0.01;

  return {
    wallet,
    v8,
    v9,
    delta,
    percentDiff,
    walletType: eligibility.walletTypeBadge,
    isClobOnly,
    isPerfectMatch,
  };
}

async function getSampleWallets(count: number): Promise<string[]> {
  // Get a mix of wallet types
  const query = `
    SELECT DISTINCT lower(wallet_address) as wallet
    FROM pm_unified_ledger_v8_tbl
    WHERE event_time >= now() - INTERVAL 30 DAY
      AND wallet_address != ''
    ORDER BY rand()
    LIMIT ${count}
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map((r: any) => r.wallet);
}

async function main() {
  const args = process.argv.slice(2);

  let wallets: string[] = [];

  if (args.includes('--sample')) {
    const countIndex = args.indexOf('--sample') + 1;
    const count = parseInt(args[countIndex] || '10', 10);
    console.log(`\n📊 Sampling ${count} random wallets for V8 vs V9 parity test...\n`);
    wallets = await getSampleWallets(count);
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    wallets = [args[0]];
  } else {
    // Default test wallets
    wallets = [
      '0x688b6ff48d3c6969bbcef35e5c5aab6f40766632', // Known good wallet
    ];
  }

  console.log(`Testing ${wallets.length} wallet(s)...\n`);
  console.log('='.repeat(100));

  const results: ParityResult[] = [];
  let clobOnlyPerfect = 0;
  let clobOnlyTotal = 0;
  let mixedCount = 0;

  for (const wallet of wallets) {
    try {
      const result = await calculateParity(wallet);
      results.push(result);

      const prefix = result.wallet.slice(0, 10);
      const matchStatus = result.isPerfectMatch ? '✅' : '⚠️';
      const typeTag = result.isClobOnly ? 'CLOB_ONLY' : 'MIXED';

      console.log(`\n${matchStatus} ${prefix}... [${typeTag}]`);
      console.log(`   V8: realized=$${result.v8.realizedPnl.toFixed(2)}, ui=$${result.v8.uiParityPnl.toFixed(2)}, events=${result.v8.eventsProcessed}`);
      console.log(`   V9: realized=$${result.v9.realizedPnl.toFixed(2)}, ui=$${result.v9.uiParityPnl.toFixed(2)}, events=${result.v9.eventsProcessed}`);
      console.log(`   Δ:  realized=$${result.delta.realizedPnl.toFixed(2)} (${result.percentDiff.realizedPnl.toFixed(2)}%), ui=$${result.delta.uiParityPnl.toFixed(2)} (${result.percentDiff.uiParityPnl.toFixed(2)}%)`);
      console.log(`   Events: V8=${result.v8.eventsProcessed}, V9=${result.v9.eventsProcessed}, Δ=${result.delta.eventsProcessed}`);

      if (result.isClobOnly) {
        clobOnlyTotal++;
        if (result.isPerfectMatch) clobOnlyPerfect++;
      } else {
        mixedCount++;
      }
    } catch (err: any) {
      console.error(`❌ ${wallet.slice(0, 10)}... - Error: ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('\n📈 SUMMARY\n');
  console.log(`Total wallets tested: ${results.length}`);
  console.log(`CLOB_ONLY wallets: ${clobOnlyTotal} (${clobOnlyPerfect} perfect matches = ${clobOnlyTotal > 0 ? ((clobOnlyPerfect / clobOnlyTotal) * 100).toFixed(1) : 0}%)`);
  console.log(`MIXED wallets: ${mixedCount} (expected to differ)`);

  // For CLOB_ONLY wallets, expect perfect parity
  if (clobOnlyTotal > 0 && clobOnlyPerfect < clobOnlyTotal) {
    console.log('\n⚠️  Some CLOB_ONLY wallets have V8/V9 differences - investigate!');
    const nonMatching = results.filter(r => r.isClobOnly && !r.isPerfectMatch);
    for (const r of nonMatching) {
      console.log(`   - ${r.wallet}: Δ realized=$${r.delta.realizedPnl.toFixed(2)}, events=${r.delta.eventsProcessed}`);
    }
  }

  process.exit(0);
}

main().catch(console.error);
