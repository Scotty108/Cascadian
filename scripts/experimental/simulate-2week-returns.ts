/**
 * Simulate 2-week copy trading returns for top 10 wallets
 * Using $1 equal-weight bets on each position
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const TOP_WALLETS = [
  '0x39fd7f7e5d025a0c442cb89a773f314f81807d31',
  '0x0bfb8009df6c46c1fdd79b65896cf224dc4526a7',
  '0x3b345c29419b69917d36af2c2be487a0f492cca8',
  '0x94df964127f1deddf1aa0f9624848f3ea4682dce',
  '0x82767c3976671a4a73e7752189f4494ec4e61204',
  '0x0f8a7eb19e45234bb81134d1f2af474b69fbfd8d',
  '0xa69b9933a2b7cdeeffaf29a119543f743c397b0c',
  '0x125eff052d1a4cc9c539f564c92d20697ebf992c',
  '0x528a616cc686eb4197e2ae686b65758cb980f94a',
  '0x524bc0719932851b9fe7755d527fd4af197249ac',
];

interface Position {
  condition_id: string;
  token_id: string;
  outcome_index: number;
  buy_price: number;
  buy_amount: number;
  payout: number; // 0 or 1
  pnl: number;
}

async function getRecentResolvedPositions(wallet: string): Promise<Position[]> {
  // Get positions that resolved in the last 2 weeks
  // First get all buys, then filter by resolution date
  const query = `
    WITH buys AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        AND side = 'buy'
        AND is_deleted = 0
      GROUP BY event_id
    ),
    token_mappings AS (
      SELECT
        token_id_dec as token_id,
        condition_id,
        outcome_index
      FROM pm_token_to_condition_map_v5
    ),
    resolutions AS (
      SELECT
        condition_id,
        payout_numerators,
        resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND resolved_at >= now() - INTERVAL 14 DAY
    )
    SELECT
      b.token_id,
      m.condition_id,
      m.outcome_index,
      b.usdc as buy_usdc,
      b.tokens as buy_tokens,
      b.usdc / NULLIF(b.tokens, 0) as entry_price,
      r.payout_numerators,
      r.resolved_at
    FROM buys b
    JOIN token_mappings m ON b.token_id = m.token_id
    JOIN resolutions r ON m.condition_id = r.condition_id
    ORDER BY r.resolved_at DESC
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    const positions: Position[] = [];
    for (const row of rows) {
      // Parse payout_numerators - it's stored as JSON string like "[1,0]" or "[0,1]"
      let payout = 0;
      try {
        const payouts = JSON.parse(row.payout_numerators);
        payout = payouts[row.outcome_index] || 0;
      } catch (e) {
        // If can't parse, assume loss
      }

      const entryPrice = row.entry_price || 0.5;
      const pnl = payout === 1 ? (1 - entryPrice) : -entryPrice;

      positions.push({
        condition_id: row.condition_id,
        token_id: row.token_id,
        outcome_index: row.outcome_index,
        buy_price: entryPrice,
        buy_amount: row.buy_usdc,
        payout,
        pnl,
      });
    }

    return positions;
  } catch (e) {
    console.error(`Error for ${wallet}:`, e);
    return [];
  }
}

async function main() {
  console.log('=== 2-WEEK COPY TRADING SIMULATION ===');
  console.log('Period: Last 14 days (Dec 19 - Jan 2, 2026)');
  console.log('Strategy: $1 equal-weight bet on each position\n');

  const results: {
    wallet: string;
    positions: number;
    wins: number;
    losses: number;
    winRate: number;
    avgEntryPrice: number;
    totalPnl: number;
    returnPct: number;
  }[] = [];

  for (const wallet of TOP_WALLETS) {
    const positions = await getRecentResolvedPositions(wallet);

    if (positions.length === 0) {
      console.log(wallet.slice(0, 10) + '... | No resolved positions in last 2 weeks');
      results.push({
        wallet,
        positions: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgEntryPrice: 0,
        totalPnl: 0,
        returnPct: 0,
      });
      continue;
    }

    // Dedupe by condition_id (one position per market)
    const uniquePositions = new Map<string, Position>();
    for (const p of positions) {
      if (!uniquePositions.has(p.condition_id)) {
        uniquePositions.set(p.condition_id, p);
      }
    }

    const deduped = Array.from(uniquePositions.values());
    const wins = deduped.filter(p => p.payout === 1).length;
    const losses = deduped.filter(p => p.payout === 0).length;
    const winRate = wins / deduped.length;
    const avgEntryPrice = deduped.reduce((sum, p) => sum + p.buy_price, 0) / deduped.length;

    // Simulate $1 bets
    // If win: return = 1/entry_price - 1 (e.g., entry at 50¢ → win $1, return 100%)
    // If loss: return = -1 (lost the $1 bet)
    let totalPnl = 0;
    for (const p of deduped) {
      if (p.payout === 1) {
        // Won: $1 bet returns $1/entry_price
        totalPnl += (1 / p.buy_price) - 1;
      } else {
        // Lost: $1 bet returns -$1
        totalPnl -= 1;
      }
    }

    const capitalDeployed = deduped.length; // $1 per position
    const returnPct = (totalPnl / capitalDeployed) * 100;

    results.push({
      wallet,
      positions: deduped.length,
      wins,
      losses,
      winRate,
      avgEntryPrice,
      totalPnl,
      returnPct,
    });

    const shortWallet = wallet.slice(0, 10) + '...';
    console.log(`${shortWallet} | ${deduped.length} pos | ${wins}W/${losses}L (${(winRate*100).toFixed(0)}%) | Avg ${(avgEntryPrice*100).toFixed(0)}¢ | PnL: $${totalPnl.toFixed(2)} (${returnPct.toFixed(1)}%)`);
  }

  // Sort by return percentage
  results.sort((a, b) => b.returnPct - a.returnPct);

  console.log('\n' + '═'.repeat(90));
  console.log('  2-WEEK COPY TRADING LEADERBOARD (Dec 19 - Jan 2, 2026)');
  console.log('═'.repeat(90));
  console.log('  Rank │ Wallet             │ Positions │ W/L      │ WinRate │ AvgEntry │ Return');
  console.log('─'.repeat(90));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.positions === 0) continue;

    const rank = String(i + 1).padStart(4);
    const wallet = r.wallet.slice(0, 12) + '...';
    const pos = String(r.positions).padStart(5);
    const wl = `${r.wins}W/${r.losses}L`.padEnd(8);
    const wr = (r.winRate * 100).toFixed(0) + '%';
    const entry = (r.avgEntryPrice * 100).toFixed(0) + '¢';
    const ret = (r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(1) + '%';

    console.log(`  ${rank} │ ${wallet.padEnd(18)} │ ${pos}     │ ${wl} │ ${wr.padStart(7)} │ ${entry.padStart(8)} │ ${ret.padStart(7)}`);
  }

  console.log('═'.repeat(90));

  // Summary
  const activeWallets = results.filter(r => r.positions > 0);
  const avgReturn = activeWallets.length > 0
    ? activeWallets.reduce((sum, r) => sum + r.returnPct, 0) / activeWallets.length
    : 0;
  const bestWallet = results[0];

  console.log('\nSUMMARY:');
  console.log(`  Active wallets (with trades): ${activeWallets.length}/${TOP_WALLETS.length}`);
  console.log(`  Average return across all: ${avgReturn.toFixed(1)}%`);

  if (bestWallet && bestWallet.positions > 0) {
    console.log(`  Best performer: ${bestWallet.wallet.slice(0, 12)}... with ${bestWallet.returnPct.toFixed(1)}% return`);

    if (bestWallet.returnPct > 0) {
      console.log('\n  💰 If you had copy traded the best wallet with $1 per position:');
      console.log(`     Capital deployed: $${bestWallet.positions}`);
      console.log(`     Net profit: $${bestWallet.totalPnl.toFixed(2)}`);
      console.log(`     Return: ${bestWallet.returnPct.toFixed(1)}%`);
    }
  }
}

main().catch(console.error);
