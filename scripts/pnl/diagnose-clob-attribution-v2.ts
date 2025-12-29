/**
 * Diagnose CLOB Attribution V2
 *
 * Deep dive into trade-level reconciliation:
 * 1. Paginate through ALL Activity API trades
 * 2. Compare CLOB trades by event_id or transaction_hash
 * 3. Find trades in CLOB that aren't in Activity API
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const TARGET_WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

interface ActivityTrade {
  id: string;
  type: string;
  timestamp: string;
  usdcSize: number;
  tokensTraded: number;
  side: string;
  transactionHash: string;
  proxyWallet?: string;
}

async function fetchAllActivities(wallet: string): Promise<ActivityTrade[]> {
  const allActivities: ActivityTrade[] = [];
  let offset = 0;
  const limit = 500;

  console.log('  Fetching all activities with pagination...');

  while (true) {
    const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=${limit}&offset=${offset}`;
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        console.log(`  HTTP ${response.status} at offset ${offset}`);
        break;
      }

      const data = (await response.json()) as any[];
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      for (const item of data) {
        allActivities.push({
          id: item.id || '',
          type: item.type || 'unknown',
          timestamp: item.timestamp || '',
          usdcSize: Number(item.usdcSize) || 0,
          tokensTraded: Number(item.tokensTraded) || 0,
          side: item.side || '',
          transactionHash: item.transactionHash || '',
          proxyWallet: item.proxyWallet,
        });
      }

      console.log(`    Offset ${offset}: ${data.length} items (total: ${allActivities.length})`);

      if (data.length < limit) {
        break;
      }

      offset += limit;
      await new Promise((r) => setTimeout(r, 200)); // Rate limit
    } catch (e: any) {
      console.log(`  Error at offset ${offset}: ${e.message}`);
      break;
    }
  }

  return allActivities;
}

async function getClobTrades(wallet: string): Promise<any[]> {
  const query = `
    SELECT
      event_id,
      trader_wallet,
      side,
      token_id,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens,
      fee_amount / 1e6 as fee,
      trade_time,
      transaction_hash,
      block_number
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
    ORDER BY trade_time DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as any[];
}

async function getPositions(wallet: string): Promise<{ proxyWallet: string | null; positionCount: number }> {
  try {
    const url = `https://data-api.polymarket.com/positions?user=${wallet}`;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return { proxyWallet: null, positionCount: 0 };
    }

    const positions = (await response.json()) as any[];
    if (!Array.isArray(positions)) {
      return { proxyWallet: null, positionCount: 0 };
    }

    let proxyWallet: string | null = null;
    for (const pos of positions) {
      if (pos.proxyWallet) {
        proxyWallet = pos.proxyWallet.toLowerCase();
        break;
      }
    }

    return { proxyWallet, positionCount: positions.length };
  } catch {
    return { proxyWallet: null, positionCount: 0 };
  }
}

async function checkWalletAlternatives(wallet: string): Promise<void> {
  // Check if there's a different proxy wallet with trades
  const posData = await getPositions(wallet);
  console.log(`\n--- Proxy Wallet Check ---`);
  console.log(`  Input wallet: ${wallet}`);
  console.log(`  Proxy wallet: ${posData.proxyWallet || 'same/none'}`);
  console.log(`  Positions: ${posData.positionCount}`);

  if (posData.proxyWallet && posData.proxyWallet !== wallet.toLowerCase()) {
    // Check CLOB trades for proxy wallet
    const proxyQuery = `
      SELECT count(*) as cnt, sum(usdc_amount) / 1e6 as total_usdc
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${posData.proxyWallet}')
    `;
    const result = await clickhouse.query({ query: proxyQuery, format: 'JSONEachRow' });
    const rows = (await result.json()) as any[];
    console.log(`  Proxy CLOB trades: ${rows[0]?.cnt || 0} ($${Number(rows[0]?.total_usdc || 0).toFixed(0)})`);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('DIAGNOSE CLOB ATTRIBUTION V2 - Deep Trade Reconciliation');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Target wallet: ${TARGET_WALLET}`);

  // 1. Check proxy wallet
  await checkWalletAlternatives(TARGET_WALLET);

  // 2. Fetch ALL activities
  console.log('\n--- Activity API (Full Pagination) ---');
  const activities = await fetchAllActivities(TARGET_WALLET);
  console.log(`  Total activities: ${activities.length}`);

  // Break down by type
  const byType = new Map<string, { count: number; usdc: number }>();
  for (const a of activities) {
    const stats = byType.get(a.type) || { count: 0, usdc: 0 };
    stats.count++;
    stats.usdc += a.usdcSize;
    byType.set(a.type, stats);
  }

  console.log('  By type:');
  for (const [type, stats] of byType) {
    console.log(`    ${type}: ${stats.count} ($${stats.usdc.toFixed(0)})`);
  }

  // 3. Get CLOB trades
  console.log('\n--- CLOB Trades ---');
  const clobTrades = await getClobTrades(TARGET_WALLET);
  console.log(`  Total CLOB trades: ${clobTrades.length}`);

  // 4. Compare by transaction hash
  console.log('\n--- Transaction Hash Comparison ---');
  const activityTxHashes = new Set(activities.map((a) => a.transactionHash.toLowerCase()));
  const clobTxHashes = new Set(clobTrades.map((t) => t.transaction_hash.toLowerCase()));

  const inBoth = [...activityTxHashes].filter((h) => clobTxHashes.has(h));
  const onlyInActivity = [...activityTxHashes].filter((h) => !clobTxHashes.has(h));
  const onlyInClob = [...clobTxHashes].filter((h) => !activityTxHashes.has(h));

  console.log(`  Tx in Activity API: ${activityTxHashes.size}`);
  console.log(`  Tx in CLOB: ${clobTxHashes.size}`);
  console.log(`  In both: ${inBoth.length}`);
  console.log(`  Only in Activity: ${onlyInActivity.length}`);
  console.log(`  Only in CLOB: ${onlyInClob.length}`);

  // 5. Calculate USDC for trades ONLY in CLOB
  const onlyClobSet = new Set(onlyInClob);
  let onlyClobUsdc = 0;
  let onlyClobBuys = 0;
  let onlyClobSells = 0;
  const onlyClobTrades = clobTrades.filter((t) => onlyClobSet.has(t.transaction_hash.toLowerCase()));

  for (const t of onlyClobTrades) {
    onlyClobUsdc += t.usdc;
    if (t.side === 'buy') onlyClobBuys++;
    else onlyClobSells++;
  }

  console.log(`\n--- CLOB-Only Trades Analysis ---`);
  console.log(`  Trades only in CLOB: ${onlyClobTrades.length}`);
  console.log(`  Total USDC: $${onlyClobUsdc.toFixed(0)}`);
  console.log(`  Buys: ${onlyClobBuys}, Sells: ${onlyClobSells}`);

  // Show sample CLOB-only trades
  if (onlyClobTrades.length > 0) {
    console.log('  Sample CLOB-only trades:');
    for (const t of onlyClobTrades.slice(0, 5)) {
      console.log(
        `    ${t.trade_time} | ${t.side} | $${t.usdc.toFixed(2)} | ${t.tokens.toFixed(2)} tokens | tx: ${t.transaction_hash.slice(0, 12)}...`
      );
    }
  }

  // 6. Net cashflow analysis
  console.log('\n--- Net Cashflow Breakdown ---');
  let clobNetCashflow = 0;
  for (const t of clobTrades) {
    if (t.side === 'buy') {
      clobNetCashflow -= t.usdc + t.fee;
    } else {
      clobNetCashflow += t.usdc - t.fee;
    }
  }

  let activityNetCashflow = 0;
  const trades = activities.filter((a) => a.type === 'TRADE');
  for (const a of trades) {
    if (a.side === 'BUY') {
      activityNetCashflow -= a.usdcSize;
    } else {
      activityNetCashflow += a.usdcSize;
    }
  }

  console.log(`  CLOB net cashflow: $${clobNetCashflow.toFixed(0)}`);
  console.log(`  Activity API trades net: $${activityNetCashflow.toFixed(0)}`);
  console.log(`  Difference: $${(clobNetCashflow - activityNetCashflow).toFixed(0)}`);

  // 7. Check if CLOB-only trades explain the gap
  let clobOnlyNet = 0;
  for (const t of onlyClobTrades) {
    if (t.side === 'buy') {
      clobOnlyNet -= t.usdc + t.fee;
    } else {
      clobOnlyNet += t.usdc - t.fee;
    }
  }

  console.log(`\n--- Gap Analysis ---`);
  console.log(`  CLOB-only trades net: $${clobOnlyNet.toFixed(0)}`);
  console.log(`  This would explain: ${((clobOnlyNet / clobNetCashflow) * 100).toFixed(1)}% of CLOB cashflow`);

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
