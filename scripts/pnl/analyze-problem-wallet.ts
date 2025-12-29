/**
 * Deep analysis of problematic wallet PnL
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '../../lib/pnl/loadResolutionsStrict';

async function analyzeWallet(client: any, wallet: string, resolutions: Map<string, number>) {
  console.log('\n' + '='.repeat(70));
  console.log('Wallet:', wallet);
  console.log('='.repeat(70));

  // Load maker trades
  const tradeResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(token_id) as token_id, any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0 AND role = 'maker'
        GROUP BY event_id
      ) SELECT * FROM deduped ORDER BY token_id
    `,
    format: 'JSONEachRow',
  });
  const trades = (await tradeResult.json()) as any[];

  // Process to get positions
  const positions = new Map<string, Position>();
  for (const t of trades) {
    let pos = positions.get(t.token_id) || emptyPosition('', t.token_id);
    const price =
      Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;
    if (t.side === 'buy') {
      pos = updateWithBuy(pos, Number(t.token_amount), price);
    } else {
      const { position: newPos } = updateWithSell(pos, Number(t.token_amount), price);
      pos = newPos;
    }
    positions.set(t.token_id, pos);
  }

  // Analyze positions
  let totalRealized = 0;
  let totalUnrealized = 0;
  let resolvedWin = 0;
  let resolvedLoss = 0;
  let openCount = 0;
  let resolvedCount = 0;
  let openPositionValue = 0;

  interface BigPos {
    tokenId: string;
    amount: number;
    avgPrice: number;
    payout: number;
    unrealized: number;
  }
  const bigPositions: BigPos[] = [];

  for (const [tokenId, pos] of positions) {
    totalRealized += pos.realizedPnl;
    const payout = resolutions.get(tokenId);

    if (pos.amount > 0) {
      if (payout !== undefined) {
        const unrealized = pos.amount * (payout - pos.avgPrice);
        totalUnrealized += unrealized;
        resolvedCount++;
        if (unrealized > 0) resolvedWin += unrealized;
        else resolvedLoss += unrealized;
        if (Math.abs(unrealized) > 10000) {
          bigPositions.push({
            tokenId: tokenId.slice(0, 15) + '...',
            amount: pos.amount,
            avgPrice: pos.avgPrice,
            payout,
            unrealized,
          });
        }
      } else {
        openCount++;
        openPositionValue += pos.amount * pos.avgPrice;
      }
    }
  }

  console.log('\nSummary:');
  console.log('  Total realized PnL:', totalRealized.toFixed(0));
  console.log('  Total unrealized PnL:', totalUnrealized.toFixed(0));
  console.log('  TOTAL:', (totalRealized + totalUnrealized).toFixed(0));
  console.log('\nUnrealized breakdown:');
  console.log('  Resolved wins:', resolvedWin.toFixed(0));
  console.log('  Resolved losses:', resolvedLoss.toFixed(0));
  console.log('  Open positions count:', openCount);
  console.log('  Open positions cost basis:', openPositionValue.toFixed(0));
  console.log('  Resolved positions count:', resolvedCount);

  if (bigPositions.length > 0) {
    console.log('\nBiggest unrealized LOSSES (showing why engine is negative):');
    bigPositions.sort((a, b) => a.unrealized - b.unrealized);
    for (const p of bigPositions.slice(0, 10)) {
      console.log('  Token:', p.tokenId);
      console.log(
        '    Amount:',
        p.amount.toFixed(0),
        'avgPrice:',
        p.avgPrice.toFixed(4),
        'payout:',
        p.payout
      );
      console.log('    Unrealized:', p.unrealized.toFixed(0));
    }
  }
}

async function main() {
  const client = getClickHouseClient();

  // Load resolutions using strict loader (filters out empty payout_numerators)
  console.log('Loading resolutions with strict filtering...');
  const { resolutions, stats } = await loadResolutionsStrict();
  console.log('Resolution stats:');
  console.log('  Fully resolved:', stats.fullyResolved.toLocaleString());
  console.log('  Unresolved (empty):', stats.unresolvedEmpty.toLocaleString());
  console.log('  Loaded to map:', resolutions.size.toLocaleString());

  // Analyze the wallet with -$1.4M engine PnL vs +$214k UI
  await analyzeWallet(client, '0x7f3c8979d0afa00007bae4747d5347122af05613', resolutions);
}

main().catch(console.error);
