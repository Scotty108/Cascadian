/**
 * 2-week copy trading simulation - optimized version
 * Uses token_ids from recently resolved conditions to query trades
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

async function main() {
  console.log('=== 2-WEEK COPY TRADING SIMULATION ===');
  console.log('Period: Last 14 days (Dec 19 - Jan 2, 2026)');
  console.log('Strategy: $1 equal-weight bet on each position\n');

  // Single efficient query that gets everything at once
  const walletList = TOP_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',');

  const query = `
    WITH
    -- Get recently resolved conditions with payouts
    recent_resolutions AS (
      SELECT
        condition_id,
        payout_numerators,
        resolved_at
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
        AND resolved_at >= now() - INTERVAL 14 DAY
    ),
    -- Get token mappings for these conditions
    resolved_tokens AS (
      SELECT
        m.token_id_dec as token_id,
        m.condition_id,
        m.outcome_index,
        r.payout_numerators,
        r.resolved_at
      FROM pm_token_to_condition_map_v5 m
      JOIN recent_resolutions r ON m.condition_id = r.condition_id
    ),
    -- Get wallet buys for these tokens only
    wallet_buys AS (
      SELECT
        lower(trader_wallet) as wallet,
        token_id,
        sum(usdc_amount) / 1e6 as total_usdc,
        sum(token_amount) / 1e6 as total_tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) IN (${walletList})
        AND side = 'buy'
        AND is_deleted = 0
        AND token_id IN (SELECT token_id FROM resolved_tokens)
      GROUP BY lower(trader_wallet), token_id
    )
    SELECT
      b.wallet,
      t.condition_id,
      t.outcome_index,
      b.total_usdc,
      b.total_tokens,
      b.total_usdc / NULLIF(b.total_tokens, 0) as entry_price,
      t.payout_numerators,
      t.resolved_at
    FROM wallet_buys b
    JOIN resolved_tokens t ON b.token_id = t.token_id
    ORDER BY b.wallet, t.resolved_at DESC
  `;

  console.log('Running optimized query...\n');

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    console.log(`Found ${rows.length} resolved positions across all wallets\n`);

    // Group by wallet and calculate stats
    const walletPositions = new Map<string, {
      positions: { condition_id: string, entry_price: number, payout: number }[],
      seenConditions: Set<string>
    }>();

    for (const wallet of TOP_WALLETS) {
      walletPositions.set(wallet.toLowerCase(), { positions: [], seenConditions: new Set() });
    }

    for (const row of rows) {
      const wallet = row.wallet.toLowerCase();
      const data = walletPositions.get(wallet);
      if (!data) continue;

      // Skip if already counted this condition
      if (data.seenConditions.has(row.condition_id)) continue;
      data.seenConditions.add(row.condition_id);

      // Parse payout
      let payout = 0;
      try {
        const payouts = JSON.parse(row.payout_numerators);
        payout = payouts[row.outcome_index] || 0;
      } catch (e) {}

      data.positions.push({
        condition_id: row.condition_id,
        entry_price: Number(row.entry_price),
        payout,
      });
    }

    // Calculate results for each wallet
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
      const data = walletPositions.get(wallet.toLowerCase());
      if (!data || data.positions.length === 0) {
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

      const positions = data.positions;
      const wins = positions.filter(p => p.payout === 1).length;
      const losses = positions.filter(p => p.payout === 0).length;
      const winRate = wins / positions.length;
      const avgEntryPrice = positions.reduce((sum, p) => sum + p.entry_price, 0) / positions.length;

      // Simulate $1 bets
      let totalPnl = 0;
      for (const p of positions) {
        if (p.payout === 1) {
          totalPnl += (1 / p.entry_price) - 1;
        } else {
          totalPnl -= 1;
        }
      }

      const returnPct = (totalPnl / positions.length) * 100;

      results.push({
        wallet,
        positions: positions.length,
        wins,
        losses,
        winRate,
        avgEntryPrice,
        totalPnl,
        returnPct,
      });

      console.log(`${wallet.slice(0, 12)}... | ${positions.length} pos | ${wins}W/${losses}L (${(winRate*100).toFixed(0)}%) | Avg ${(avgEntryPrice*100).toFixed(0)}¢ | Return: ${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(1)}%`);
    }

    // Sort by return percentage
    results.sort((a, b) => b.returnPct - a.returnPct);

    console.log('\n' + '═'.repeat(100));
    console.log('  2-WEEK COPY TRADING LEADERBOARD (Dec 19 - Jan 2, 2026)');
    console.log('═'.repeat(100));
    console.log('  Rank │ Wallet                                     │ Pos │ W/L       │ WinRate │ AvgEntry │ Return');
    console.log('─'.repeat(100));

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.positions === 0) continue;

      const rank = String(i + 1).padStart(4);
      const wallet = r.wallet;
      const pos = String(r.positions).padStart(3);
      const wl = `${r.wins}W/${r.losses}L`.padEnd(9);
      const wr = (r.winRate * 100).toFixed(0) + '%';
      const entry = (r.avgEntryPrice * 100).toFixed(0) + '¢';
      const ret = (r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(1) + '%';

      console.log(`  ${rank} │ ${wallet} │ ${pos} │ ${wl} │ ${wr.padStart(7)} │ ${entry.padStart(8)} │ ${ret.padStart(7)}`);
    }

    console.log('═'.repeat(100));

    // Summary
    const activeWallets = results.filter(r => r.positions > 0);
    const avgReturn = activeWallets.length > 0
      ? activeWallets.reduce((sum, r) => sum + r.returnPct, 0) / activeWallets.length
      : 0;
    const bestWallet = results[0];
    const worstWallet = results[results.length - 1];

    console.log('\n=== SUMMARY ===');
    console.log(`Active wallets (with 2-week resolved trades): ${activeWallets.length}/${TOP_WALLETS.length}`);
    console.log(`Average return across active: ${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(1)}%`);

    if (bestWallet && bestWallet.positions > 0) {
      console.log(`\nBEST: ${bestWallet.wallet.slice(0, 12)}... | ${bestWallet.positions} positions | ${bestWallet.returnPct >= 0 ? '+' : ''}${bestWallet.returnPct.toFixed(1)}% return`);
    }

    if (worstWallet && worstWallet.positions > 0 && worstWallet.wallet !== bestWallet?.wallet) {
      console.log(`WORST: ${worstWallet.wallet.slice(0, 12)}... | ${worstWallet.positions} positions | ${worstWallet.returnPct >= 0 ? '+' : ''}${worstWallet.returnPct.toFixed(1)}% return`);
    }

    // Portfolio simulation
    console.log('\n=== PORTFOLIO SIMULATION ===');
    console.log('If you had copy traded ALL 10 wallets with $1 per position:');

    let totalPositions = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let portfolioPnl = 0;

    for (const r of results) {
      totalPositions += r.positions;
      totalWins += r.wins;
      totalLosses += r.losses;
      portfolioPnl += r.totalPnl;
    }

    console.log(`  Total positions: ${totalPositions}`);
    console.log(`  Total capital deployed: $${totalPositions}`);
    console.log(`  Total wins: ${totalWins}`);
    console.log(`  Total losses: ${totalLosses}`);
    console.log(`  Overall win rate: ${(totalWins / totalPositions * 100).toFixed(1)}%`);
    console.log(`  Net profit: $${portfolioPnl.toFixed(2)}`);
    console.log(`  Portfolio return: ${(portfolioPnl / totalPositions * 100).toFixed(1)}%`);

    // Show inactive wallets
    const inactiveWallets = results.filter(r => r.positions === 0);
    if (inactiveWallets.length > 0) {
      console.log('\nWallets with NO resolved positions in last 2 weeks:');
      for (const w of inactiveWallets) {
        console.log(`  - ${w.wallet}`);
      }
    }

  } catch (e) {
    console.error('Query failed:', e);
  }
}

main().catch(console.error);
