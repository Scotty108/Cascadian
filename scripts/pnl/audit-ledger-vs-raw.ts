/**
 * Ledger vs Raw Source Audit Script (Simplified)
 *
 * Compares raw CLOB trades (pm_trader_events_v2) against the unified ledger
 * (pm_unified_ledger_v7) to identify data ingestion gaps for benchmark wallets.
 *
 * This helps diagnose why certain wallets have PnL calculation errors.
 *
 * Terminal: Claude 1 (Auditor Track)
 * Date: 2025-12-04
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface WalletAuditResult {
  wallet: string;
  raw_trade_count: number;
  raw_trade_volume: number;
  ledger_trade_count: number;
  ledger_usdc_delta: number;
  ctf_event_count: number;
  ctf_unique_conditions: number;
  ledger_unique_conditions: number;
  status: 'ok' | 'warning' | 'missing_data';
  notes: string[];
}

async function auditWallet(wallet: string): Promise<WalletAuditResult> {
  const walletLower = wallet.toLowerCase();
  const notes: string[] = [];

  // 1. Count raw CLOB trades (with deduplication)
  const rawTradesQuery = `
    SELECT
      count(DISTINCT event_id) as trade_count,
      sum(usdc_amount) / 1e6 as total_usdc,
      uniq(token_id) as unique_tokens
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = '${walletLower}'
      AND is_deleted = 0
  `;

  let rawTradeCount = 0;
  let rawTradeVolume = 0;
  let rawUniqueTokens = 0;

  try {
    const rawResult = await clickhouse.query({ query: rawTradesQuery, format: 'JSONEachRow' });
    const rawRows = (await rawResult.json()) as any[];
    if (rawRows.length > 0) {
      rawTradeCount = Number(rawRows[0].trade_count);
      rawTradeVolume = Number(rawRows[0].total_usdc);
      rawUniqueTokens = Number(rawRows[0].unique_tokens);
    }
  } catch (e: any) {
    notes.push(`Raw trades query failed: ${e.message}`);
  }

  // 2. Count ledger entries (Trade source type)
  const ledgerTradesQuery = `
    SELECT
      count() as trade_count,
      sum(abs(usdc_delta)) as total_usdc,
      uniq(condition_id) as unique_conditions
    FROM pm_unified_ledger_v7
    WHERE lower(wallet_address) = '${walletLower}'
      AND source_type = 'Trade'
  `;

  let ledgerTradeCount = 0;
  let ledgerUsdcDelta = 0;
  let ledgerUniqueConditions = 0;

  try {
    const ledgerResult = await clickhouse.query({ query: ledgerTradesQuery, format: 'JSONEachRow' });
    const ledgerRows = (await ledgerResult.json()) as any[];
    if (ledgerRows.length > 0) {
      ledgerTradeCount = Number(ledgerRows[0].trade_count);
      ledgerUsdcDelta = Number(ledgerRows[0].total_usdc);
      ledgerUniqueConditions = Number(ledgerRows[0].unique_conditions);
    }
  } catch (e: any) {
    notes.push(`Ledger query failed: ${e.message}`);
  }

  // 3. Count CTF events (PositionSplit, PayoutRedemption, etc.)
  const ctfQuery = `
    SELECT
      count() as event_count,
      uniq(condition_id) as unique_conditions,
      countIf(event_type = 'PositionSplit') as split_count,
      countIf(event_type = 'PayoutRedemption') as redemption_count,
      countIf(event_type = 'PositionsMerge') as merge_count
    FROM pm_ctf_events
    WHERE lower(user_address) = '${walletLower}'
      AND is_deleted = 0
  `;

  let ctfEventCount = 0;
  let ctfUniqueConditions = 0;

  try {
    const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
    const ctfRows = (await ctfResult.json()) as any[];
    if (ctfRows.length > 0) {
      ctfEventCount = Number(ctfRows[0].event_count);
      ctfUniqueConditions = Number(ctfRows[0].unique_conditions);

      if (ctfRows[0].split_count > 0) {
        notes.push(`${ctfRows[0].split_count} PositionSplit events`);
      }
      if (ctfRows[0].redemption_count > 0) {
        notes.push(`${ctfRows[0].redemption_count} PayoutRedemption events`);
      }
      if (ctfRows[0].merge_count > 0) {
        notes.push(`${ctfRows[0].merge_count} PositionsMerge events`);
      }
    }
  } catch (e: any) {
    notes.push(`CTF events query failed: ${e.message}`);
  }

  // Determine status
  let status: 'ok' | 'warning' | 'missing_data' = 'ok';

  if (rawTradeCount === 0 && ledgerTradeCount === 0) {
    status = 'missing_data';
    notes.push('No trade data found in either source');
  } else if (ledgerTradeCount === 0 && rawTradeCount > 0) {
    status = 'missing_data';
    notes.push(`Missing ${rawTradeCount} trades in ledger`);
  } else if (Math.abs(rawTradeCount - ledgerTradeCount) > rawTradeCount * 0.1) {
    status = 'warning';
    notes.push(`Trade count mismatch: raw=${rawTradeCount}, ledger=${ledgerTradeCount}`);
  }

  return {
    wallet: walletLower,
    raw_trade_count: rawTradeCount,
    raw_trade_volume: rawTradeVolume,
    ledger_trade_count: ledgerTradeCount,
    ledger_usdc_delta: ledgerUsdcDelta,
    ctf_event_count: ctfEventCount,
    ctf_unique_conditions: ctfUniqueConditions,
    ledger_unique_conditions: ledgerUniqueConditions,
    status,
    notes,
  };
}

async function loadBenchmarkWallets(benchmarkSet: string): Promise<{ wallet: string; pnl_value: number; note: string }[]> {
  const query = `
    SELECT wallet, pnl_value, note
    FROM pm_ui_pnl_benchmarks_v1
    WHERE benchmark_set = '${benchmarkSet}'
    ORDER BY abs(pnl_value) DESC
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as any[];
}

async function main() {
  const args = process.argv.slice(2);

  let benchmarkSet = 'fresh_2025_12_04_alltime';
  let singleWallet: string | null = null;
  let limit = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set' && args[i + 1]) {
      benchmarkSet = args[i + 1];
      i++;
    } else if (args[i] === '--wallet' && args[i + 1]) {
      singleWallet = args[i + 1].toLowerCase();
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    }
  }

  console.log('='.repeat(120));
  console.log('LEDGER VS RAW SOURCE AUDIT');
  console.log('='.repeat(120));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Benchmark Set: ${benchmarkSet}`);
  if (singleWallet) console.log(`Single Wallet: ${singleWallet}`);
  console.log('');

  let wallets: { wallet: string; pnl_value: number; note: string }[];

  if (singleWallet) {
    wallets = [{ wallet: singleWallet, pnl_value: 0, note: 'manual' }];
  } else {
    wallets = await loadBenchmarkWallets(benchmarkSet);
    wallets = wallets.slice(0, limit);
    console.log(`Auditing top ${wallets.length} wallets from benchmark set`);
  }

  console.log('');
  console.log('Wallet           | Raw Trades | Ledger Trades | Volume ($)     | CTF Events | Status');
  console.log('-'.repeat(120));

  const results: WalletAuditResult[] = [];

  for (const { wallet, note } of wallets) {
    const result = await auditWallet(wallet);
    results.push(result);

    const statusEmoji = result.status === 'ok' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';

    console.log(
      `${wallet.substring(0, 14)}... | ` +
        `${result.raw_trade_count.toString().padStart(10)} | ` +
        `${result.ledger_trade_count.toString().padStart(13)} | ` +
        `${result.raw_trade_volume.toLocaleString().padStart(14)} | ` +
        `${result.ctf_event_count.toString().padStart(10)} | ` +
        `${statusEmoji} ${result.status}`
    );
  }

  // Summary
  console.log('\n' + '-'.repeat(120));
  console.log('SUMMARY');
  console.log('-'.repeat(120));

  const okCount = results.filter((r) => r.status === 'ok').length;
  const warningCount = results.filter((r) => r.status === 'warning').length;
  const missingCount = results.filter((r) => r.status === 'missing_data').length;

  console.log(`✅ OK:            ${okCount}/${results.length}`);
  console.log(`⚠️  Warning:       ${warningCount}/${results.length}`);
  console.log(`❌ Missing Data:  ${missingCount}/${results.length}`);

  // Total volumes
  const totalRawVolume = results.reduce((sum, r) => sum + r.raw_trade_volume, 0);
  const totalLedgerVolume = results.reduce((sum, r) => sum + r.ledger_usdc_delta, 0);

  console.log('');
  console.log(`Total Raw Trade Volume:    $${totalRawVolume.toLocaleString()}`);
  console.log(`Total Ledger USDC Delta:   $${totalLedgerVolume.toLocaleString()}`);

  // Show problem wallets with notes
  const problemWallets = results.filter((r) => r.status !== 'ok');
  if (problemWallets.length > 0) {
    console.log('\n' + '-'.repeat(120));
    console.log('PROBLEM WALLETS');
    console.log('-'.repeat(120));

    for (const r of problemWallets) {
      console.log(`\n${r.wallet}`);
      console.log(`  Status: ${r.status.toUpperCase()}`);
      console.log(`  Raw trades: ${r.raw_trade_count}, Ledger trades: ${r.ledger_trade_count}`);
      console.log(`  CTF events: ${r.ctf_event_count}, CTF conditions: ${r.ctf_unique_conditions}`);
      if (r.notes.length > 0) {
        console.log(`  Notes:`);
        for (const note of r.notes) {
          console.log(`    - ${note}`);
        }
      }
    }
  }

  console.log('\n' + '='.repeat(120));
  console.log('AUDIT COMPLETE');
  console.log('='.repeat(120));
}

main().catch(console.error);
