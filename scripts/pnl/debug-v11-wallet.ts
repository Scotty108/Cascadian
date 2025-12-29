/**
 * Debug V11 engine on a specific wallet
 */
import { calculateWalletPnl as calculateV11Pnl } from '../../lib/pnl/polymarketSubgraphEngine';
import { loadPolymarketPnlEventsForWallet } from '../../lib/pnl/polymarketEventLoader';

const wallet = process.argv[2] || '0xdbaed59f8730b3ae23e0b38196e091208431f4ff';

async function debug() {
  console.log(`Debugging wallet: ${wallet}\n`);

  // Load events
  const { events, gapStats } = await loadPolymarketPnlEventsForWallet(wallet, {
    includeSyntheticRedemptions: false,
    includeErc1155Transfers: false
  });

  console.log('=== Events Summary ===');
  console.log('Total events:', events.length);
  console.log('Gap stats:', gapStats);

  // Count by type
  const byType: Record<string, { count: number, usdcSum: number }> = {};
  for (const e of events) {
    const t = e.eventType;
    if (!byType[t]) byType[t] = { count: 0, usdcSum: 0 };
    byType[t].count++;
    // For CLOB trades, use rawUsdcAmount; for others estimate
    if (e.rawUsdcAmount) {
      byType[t].usdcSum += Number(e.rawUsdcAmount) / 1e6;
    } else if (e.amount) {
      byType[t].usdcSum += Number(e.amount) / 1e6;
    }
  }

  console.log('\nBy event type:');
  for (const [type, data] of Object.entries(byType)) {
    console.log('  ', type, 'count:', data.count, 'usdc~:', data.usdcSum.toFixed(2));
  }

  // Calculate PnL
  const result = calculateV11Pnl(events);

  console.log('\n=== V11 Engine Result ===');
  console.log('Realized PnL:', (Number(result.realizedPnlRaw) / 1e6).toFixed(2));
  console.log('Unrealized PnL:', (Number(result.unrealizedPnlRaw) / 1e6).toFixed(2));
  console.log('\nEvent counts:', result.eventCounts);

  console.log('\nPositions with non-zero values:');
  let posCount = 0;
  for (const [tokenId, pos] of result.positions.entries()) {
    const shares = Number(pos.shares) / 1e6;
    const realizedPnl = Number(pos.realizedPnl) / 1e6;
    const avgCost = Number(pos.avgCost) / 1e6;

    if (Math.abs(shares) > 0.01 || Math.abs(realizedPnl) > 0.01) {
      posCount++;
      console.log(`  Token: ${tokenId.slice(0, 20)}...`);
      console.log(`    shares: ${shares.toFixed(2)}`);
      console.log(`    avgCost: ${avgCost.toFixed(6)}`);
      console.log(`    realizedPnL: ${realizedPnl.toFixed(2)}`);
    }
  }
  console.log(`\nTotal positions with activity: ${posCount}`);
}

debug().catch(console.error);
