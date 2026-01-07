/**
 * Fast 2-week copy trading simulation using resolution-first approach
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

async function getRecentResolutions(): Promise<Map<string, { payouts: number[], resolved_at: string }>> {
  console.log('Fetching recently resolved conditions...');

  const query = `
    SELECT
      condition_id,
      payout_numerators,
      resolved_at
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
      AND resolved_at >= now() - INTERVAL 14 DAY
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const map = new Map<string, { payouts: number[], resolved_at: string }>();
  for (const row of rows) {
    try {
      const payouts = JSON.parse(row.payout_numerators);
      map.set(row.condition_id, { payouts, resolved_at: row.resolved_at });
    } catch (e) {
      // Skip if can't parse
    }
  }

  console.log(`Found ${map.size} conditions resolved in last 2 weeks\n`);
  return map;
}

async function getTokenMappings(): Promise<Map<string, { condition_id: string, outcome_index: number }>> {
  console.log('Loading token mappings...');

  const query = `
    SELECT
      token_id_dec as token_id,
      condition_id,
      outcome_index
    FROM pm_token_to_condition_map_v5
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const map = new Map<string, { condition_id: string, outcome_index: number }>();
  for (const row of rows) {
    map.set(row.token_id, {
      condition_id: row.condition_id,
      outcome_index: Number(row.outcome_index),
    });
  }

  console.log(`Loaded ${map.size} token mappings\n`);
  return map;
}

async function getWalletBuys(wallet: string): Promise<Map<string, { usdc: number, tokens: number }>> {
  // Get aggregated buys by token_id for this wallet
  const query = `
    SELECT
      token_id,
      sum(usdc_amount) / 1e6 as total_usdc,
      sum(token_amount) / 1e6 as total_tokens
    FROM (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(usdc_amount) as usdc_amount,
        any(token_amount) as token_amount
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
        AND side = 'buy'
        AND is_deleted = 0
      GROUP BY event_id
    )
    GROUP BY token_id
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const map = new Map<string, { usdc: number, tokens: number }>();
  for (const row of rows) {
    map.set(row.token_id, {
      usdc: Number(row.total_usdc),
      tokens: Number(row.total_tokens),
    });
  }

  return map;
}

async function main() {
  console.log('=== 2-WEEK COPY TRADING SIMULATION (Fast) ===');
  console.log('Period: Last 14 days (Dec 19 - Jan 2, 2026)');
  console.log('Strategy: $1 equal-weight bet on each position\n');

  // Step 1: Get recently resolved conditions
  const resolutions = await getRecentResolutions();

  // Step 2: Get token mappings
  const tokenMappings = await getTokenMappings();

  // Step 3: For each wallet, calculate returns
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
    console.log(`Processing ${wallet.slice(0, 10)}...`);

    // Get wallet's buys
    const buys = await getWalletBuys(wallet);

    // Find resolved positions
    interface ResolvedPosition {
      condition_id: string;
      entry_price: number;
      payout: number;
    }

    const resolvedPositions: ResolvedPosition[] = [];
    const seenConditions = new Set<string>();

    for (const [tokenId, buyData] of buys) {
      const mapping = tokenMappings.get(tokenId);
      if (!mapping) continue;

      const resolution = resolutions.get(mapping.condition_id);
      if (!resolution) continue;

      // Skip if we've already counted this condition
      if (seenConditions.has(mapping.condition_id)) continue;
      seenConditions.add(mapping.condition_id);

      const entryPrice = buyData.usdc / buyData.tokens;
      const payout = resolution.payouts[mapping.outcome_index] || 0;

      resolvedPositions.push({
        condition_id: mapping.condition_id,
        entry_price: entryPrice,
        payout,
      });
    }

    if (resolvedPositions.length === 0) {
      console.log(`  -> No resolved positions in last 2 weeks`);
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

    // Calculate stats
    const wins = resolvedPositions.filter(p => p.payout === 1).length;
    const losses = resolvedPositions.filter(p => p.payout === 0).length;
    const winRate = wins / resolvedPositions.length;
    const avgEntryPrice = resolvedPositions.reduce((sum, p) => sum + p.entry_price, 0) / resolvedPositions.length;

    // Simulate $1 bets
    let totalPnl = 0;
    for (const p of resolvedPositions) {
      if (p.payout === 1) {
        // Won: $1 bet returns $1/entry_price
        totalPnl += (1 / p.entry_price) - 1;
      } else {
        // Lost: $1 bet returns -$1
        totalPnl -= 1;
      }
    }

    const capitalDeployed = resolvedPositions.length;
    const returnPct = (totalPnl / capitalDeployed) * 100;

    results.push({
      wallet,
      positions: resolvedPositions.length,
      wins,
      losses,
      winRate,
      avgEntryPrice,
      totalPnl,
      returnPct,
    });

    console.log(`  -> ${resolvedPositions.length} pos | ${wins}W/${losses}L (${(winRate*100).toFixed(0)}%) | Avg ${(avgEntryPrice*100).toFixed(0)}¢ | Return: ${returnPct.toFixed(1)}%`);
  }

  // Sort by return percentage
  results.sort((a, b) => b.returnPct - a.returnPct);

  console.log('\n' + '═'.repeat(95));
  console.log('  2-WEEK COPY TRADING LEADERBOARD (Dec 19 - Jan 2, 2026)');
  console.log('═'.repeat(95));
  console.log('  Rank │ Wallet                                     │ Pos │ W/L      │ WinRate │ AvgEntry │ Return');
  console.log('─'.repeat(95));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.positions === 0) continue;

    const rank = String(i + 1).padStart(4);
    const wallet = r.wallet;
    const pos = String(r.positions).padStart(3);
    const wl = `${r.wins}W/${r.losses}L`.padEnd(8);
    const wr = (r.winRate * 100).toFixed(0) + '%';
    const entry = (r.avgEntryPrice * 100).toFixed(0) + '¢';
    const ret = (r.returnPct >= 0 ? '+' : '') + r.returnPct.toFixed(1) + '%';

    console.log(`  ${rank} │ ${wallet} │ ${pos} │ ${wl} │ ${wr.padStart(7)} │ ${entry.padStart(8)} │ ${ret.padStart(7)}`);
  }

  console.log('═'.repeat(95));

  // Summary
  const activeWallets = results.filter(r => r.positions > 0);
  const avgReturn = activeWallets.length > 0
    ? activeWallets.reduce((sum, r) => sum + r.returnPct, 0) / activeWallets.length
    : 0;
  const bestWallet = results[0];

  console.log('\nSUMMARY:');
  console.log(`  Active wallets (with 2-week resolved trades): ${activeWallets.length}/${TOP_WALLETS.length}`);
  console.log(`  Average return across active: ${avgReturn.toFixed(1)}%`);

  if (bestWallet && bestWallet.positions > 0) {
    console.log(`  Best performer: ${bestWallet.wallet.slice(0, 12)}... with ${bestWallet.returnPct.toFixed(1)}% return`);

    console.log('\n  COPY TRADING SIMULATION RESULT:');
    console.log(`  If you had copy traded ${bestWallet.wallet.slice(0,12)}... with $1 per position:`);
    console.log(`     Positions taken: ${bestWallet.positions}`);
    console.log(`     Capital deployed: $${bestWallet.positions}`);
    console.log(`     Net profit: $${bestWallet.totalPnl.toFixed(2)}`);
    console.log(`     Return: ${bestWallet.returnPct.toFixed(1)}%`);
    console.log(`     Win rate: ${(bestWallet.winRate * 100).toFixed(0)}%`);
    console.log(`     Avg entry price: ${(bestWallet.avgEntryPrice * 100).toFixed(0)}¢`);
  }

  // Show inactive wallets
  const inactiveWallets = results.filter(r => r.positions === 0);
  if (inactiveWallets.length > 0) {
    console.log(`\n  Wallets with NO resolved positions in last 2 weeks:`);
    for (const w of inactiveWallets) {
      console.log(`    - ${w.wallet}`);
    }
  }
}

main().catch(console.error);
