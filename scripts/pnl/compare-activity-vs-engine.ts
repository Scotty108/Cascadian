/**
 * Compare Polymarket Activity API data vs our V11_POLY engine
 *
 * Fetches all activity (trades + redemptions) from API and computes
 * raw cash flow to compare against V11_POLY.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';
import { computeWalletPnlFromEvents } from '../../lib/pnl/polymarketSubgraphEngine';

interface ActivityItem {
  type: string;
  side?: string;
  size: number;
  usdcSize: number;
  price: number;
  timestamp: number;
  conditionId: string;
  outcome?: string;
  transactionHash: string;
}

async function fetchAllActivity(wallet: string): Promise<ActivityItem[]> {
  const allActivity: ActivityItem[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://data-api.polymarket.com/activity?user=${wallet}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Cascadian-Validation/1.0',
      },
    });

    if (!response.ok) {
      console.log(`API error at offset ${offset}: ${response.status}`);
      break;
    }

    const items: ActivityItem[] = await response.json();
    if (items.length === 0) break;

    allActivity.push(...items);
    offset += items.length;

    if (items.length < limit) break; // Last page

    // Safety limit
    if (offset > 10000) {
      console.log('Hit safety limit at 10000 items');
      break;
    }
  }

  return allActivity;
}

async function main() {
  const wallet = process.argv[2] || '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'; // W2

  console.log('='.repeat(80));
  console.log(`COMPARE ACTIVITY API VS V11_POLY`);
  console.log(`Wallet: ${wallet}`);
  console.log('='.repeat(80));

  // Fetch all activity
  console.log('\n1. Fetching all activity from Polymarket API...');
  const activity = await fetchAllActivity(wallet);
  console.log(`   Total activity items: ${activity.length}`);

  // Compute cash flow from activity
  let totalBuyCost = 0;
  let totalSellProceeds = 0;
  let totalRedeemPayout = 0;
  let buyCount = 0;
  let sellCount = 0;
  let redeemCount = 0;

  for (const item of activity) {
    if (item.type === 'TRADE') {
      if (item.side === 'BUY') {
        totalBuyCost += item.usdcSize;
        buyCount++;
      } else if (item.side === 'SELL') {
        totalSellProceeds += item.usdcSize;
        sellCount++;
      }
    } else if (item.type === 'REDEEM') {
      totalRedeemPayout += item.usdcSize;
      redeemCount++;
    }
  }

  const apiNetCashFlow = totalSellProceeds + totalRedeemPayout - totalBuyCost;

  console.log('\n2. Activity API Summary:');
  console.log(`   BUYs: ${buyCount} trades, $${totalBuyCost.toFixed(2)} cost`);
  console.log(`   SELLs: ${sellCount} trades, $${totalSellProceeds.toFixed(2)} proceeds`);
  console.log(`   REDEEMs: ${redeemCount} events, $${totalRedeemPayout.toFixed(2)} payout`);
  console.log(`   Net Cash Flow: $${apiNetCashFlow.toFixed(2)}`);

  // Compute V11_POLY
  console.log('\n3. Computing V11_POLY...');
  const loadResult = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: true,
  });
  const pnlResult = computeWalletPnlFromEvents(wallet, loadResult.events);

  console.log(`   Events loaded: ${loadResult.events.length}`);
  console.log(`   V11_POLY Realized PnL: $${pnlResult.realizedPnl.toFixed(2)}`);
  console.log(`   V11_POLY Volume: $${pnlResult.volume.toFixed(2)}`);
  console.log(`   Event counts: ${JSON.stringify(pnlResult.eventCounts)}`);

  // Compare
  console.log('\n4. Comparison:');
  console.log(`   API Net Cash Flow: $${apiNetCashFlow.toFixed(2)}`);
  console.log(`   V11_POLY Realized: $${pnlResult.realizedPnl.toFixed(2)}`);
  console.log(`   Delta: $${(pnlResult.realizedPnl - apiNetCashFlow).toFixed(2)}`);

  // Check event counts
  const apiTotalTrades = buyCount + sellCount;
  const engineTotalTrades = (pnlResult.eventCounts.ORDER_MATCHED_BUY || 0) + (pnlResult.eventCounts.ORDER_MATCHED_SELL || 0);
  const engineRedemptions = pnlResult.eventCounts.REDEMPTION || 0;

  console.log('\n5. Event Count Comparison:');
  console.log(`   API trades: ${apiTotalTrades} (${buyCount} buy + ${sellCount} sell)`);
  console.log(`   Engine trades: ${engineTotalTrades} (${pnlResult.eventCounts.ORDER_MATCHED_BUY} buy + ${pnlResult.eventCounts.ORDER_MATCHED_SELL} sell)`);
  console.log(`   API redemptions: ${redeemCount}`);
  console.log(`   Engine redemptions: ${engineRedemptions}`);

  // Show first few activity items
  console.log('\n6. First 5 activity items:');
  for (const item of activity.slice(0, 5)) {
    const sideStr = item.side || '';
    console.log(`   ${item.type.padEnd(6)} ${sideStr.padEnd(4)} | $${item.usdcSize.toFixed(2).padStart(10)} | ${new Date(item.timestamp * 1000).toISOString().slice(0, 10)}`);
  }

  // Show last few activity items
  console.log('\n7. Last 5 activity items:');
  for (const item of activity.slice(-5)) {
    const sideStr = item.side || '';
    console.log(`   ${item.type.padEnd(6)} ${sideStr.padEnd(4)} | $${item.usdcSize.toFixed(2).padStart(10)} | ${new Date(item.timestamp * 1000).toISOString().slice(0, 10)}`);
  }
}

main().catch(console.error);
