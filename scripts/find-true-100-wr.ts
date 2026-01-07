/**
 * Find TRUE 100% Win Rate wallets
 * Verified directly from raw trade data, not precomputed tables
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

interface WalletResult {
  wallet: string;
  positions: number;
  wins: number;
  losses: number;
  winRate: number;
  avgEntry: number;
  avgReturn: number;
  bestReturn: number;
  totalPnL: number;
  avgBet: number;
}

async function analyzeWallet(wallet: string): Promise<WalletResult | null> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          cond,
          cost_basis,
          entry_price,
          pnl,
          if(pnl > 0, 1, 0) as is_win,
          pnl / nullIf(cost_basis, 0) as return_pct
        FROM (
          SELECT
            e.cond as cond,
            sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
            sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
            sum(if(e.side = 'sell', e.usdc, 0)) +
              (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
              sum(if(e.side = 'buy', e.usdc, 0)) as pnl
          FROM (
            SELECT
              tm.condition_id as cond,
              t.side as side,
              t.usdc as usdc,
              t.tokens as tokens,
              toFloat64(arrayElement(
                JSONExtract(r.payout_numerators, 'Array(UInt64)'),
                toUInt32(tm.outcome_index + 1)
              )) / toFloat64(r.payout_denominator) as payout
            FROM (
              SELECT
                event_id,
                any(token_id) as token_id,
                any(lower(side)) as side,
                any(usdc_amount) / 1e6 as usdc,
                any(token_amount) / 1e6 as tokens
              FROM pm_trader_events_v2
              WHERE trader_wallet = '${wallet}' AND is_deleted = 0
              GROUP BY event_id
            ) t
            INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
            INNER JOIN (
              SELECT condition_id, payout_numerators, payout_denominator
              FROM pm_condition_resolutions FINAL
              WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
            ) r ON tm.condition_id = r.condition_id
          ) e
          GROUP BY e.cond
          HAVING cost_basis > 5
        )
        WHERE entry_price > 0 AND entry_price < 1
      `,
      format: 'JSONEachRow'
    });

    const positions = await result.json() as any[];
    if (positions.length < 5) return null;

    const wins = positions.filter((p: any) => p.pnl > 0);
    const losses = positions.filter((p: any) => p.pnl <= 0);

    // Must be TRUE 100% win rate
    if (losses.length > 0) return null;

    const totalPnL = positions.reduce((sum: number, p: any) => sum + p.pnl, 0);
    if (totalPnL <= 0) return null;

    const entries = positions.map((p: any) => p.entry_price).filter((e: number) => e > 0);
    const avgEntry = entries.length > 0 ? entries.reduce((a: number, b: number) => a + b, 0) / entries.length : 0;

    // Skip arbers (avg entry >= 80%)
    if (avgEntry >= 0.80) return null;

    const returns = positions.map((p: any) => p.return_pct).filter((r: number) => r > 0);
    const avgReturn = returns.length > 0 ? returns.reduce((a: number, b: number) => a + b, 0) / returns.length : 0;
    const bestReturn = returns.length > 0 ? Math.max(...returns) : 0;

    const avgBet = positions.reduce((sum: number, p: any) => sum + p.cost_basis, 0) / positions.length;

    return {
      wallet,
      positions: positions.length,
      wins: wins.length,
      losses: losses.length,
      winRate: wins.length / positions.length,
      avgEntry,
      avgReturn,
      bestReturn,
      totalPnL,
      avgBet
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('=== FINDING TRUE 100% WIN RATE WALLETS ===');
  console.log('Verified from raw trade data, not precomputed tables\n');

  // Get wallets with high win counts from precomputed (as candidates)
  const candidates = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_wallet_condition_realized_v1
      GROUP BY wallet
      HAVING
        count() >= 5
        AND sum(is_win) >= 5
        AND sum(realized_pnl) > 50
      ORDER BY sum(is_win) / count() DESC, sum(realized_pnl) DESC
      LIMIT 2000
    `,
    format: 'JSONEachRow'
  });

  const candidateList = await candidates.json() as any[];
  console.log(`Checking ${candidateList.length} candidate wallets...\n`);

  const perfect: WalletResult[] = [];
  let processed = 0;

  for (const c of candidateList) {
    processed++;
    const result = await analyzeWallet(c.wallet);

    if (result) {
      perfect.push(result);
      console.log(`✓ ${result.wallet.substring(0, 12)}... ${result.wins}/${result.positions} (100%) Entry:${(result.avgEntry * 100).toFixed(0)}% Return:${(result.avgReturn * 100).toFixed(0)}% PnL:$${result.totalPnL.toFixed(0)}`);
    }

    if (processed % 200 === 0) {
      console.log(`  [Processed ${processed}/${candidateList.length}, found ${perfect.length} perfect wallets]`);
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n🎯 TRUE 100% WIN RATE WALLETS: ${perfect.length}\n`);

  if (perfect.length === 0) {
    console.log('No wallets found with TRUE 100% win rate (5+ positions, not arbers)');
    return;
  }

  // Sort by number of wins (more wins = more impressive)
  perfect.sort((a, b) => b.wins - a.wins);

  console.log('Wallet'.padEnd(44) + 'Record'.padStart(8) + 'Entry'.padStart(8) + 'AvgRet'.padStart(10) + 'BestRet'.padStart(10) + 'PnL'.padStart(12));
  console.log('='.repeat(100));

  for (const r of perfect.slice(0, 50)) {
    console.log(
      r.wallet.padEnd(44) +
      `${r.wins}/${r.positions}`.padStart(8) +
      `${(r.avgEntry * 100).toFixed(0)}%`.padStart(8) +
      `${(r.avgReturn * 100).toFixed(0)}%`.padStart(10) +
      `${(r.bestReturn * 100).toFixed(0)}%`.padStart(10) +
      `$${r.totalPnL.toFixed(0)}`.padStart(12)
    );
  }

  // Filter for truly impressive (high returns + many wins)
  const impressive = perfect.filter(r =>
    r.wins >= 5 &&
    r.avgReturn >= 0.50 && // 50%+ avg return
    r.avgEntry < 0.60     // Not buying too close to resolution
  );

  console.log(`\n\n🔥 MOST IMPRESSIVE (5+ wins, 50%+ return, <60% entry): ${impressive.length}\n`);

  impressive.sort((a, b) => b.avgReturn - a.avgReturn);

  for (const r of impressive.slice(0, 20)) {
    console.log(r.wallet);
    console.log(`  Record:     ${r.wins}/${r.positions} (TRUE 100% WR)`);
    console.log(`  Avg Entry:  ${(r.avgEntry * 100).toFixed(1)}%`);
    console.log(`  Avg Return: ${(r.avgReturn * 100).toFixed(0)}% per trade`);
    console.log(`  Best Trade: ${(r.bestReturn * 100).toFixed(0)}% return`);
    console.log(`  Total PnL:  $${r.totalPnL.toFixed(2)}`);
    console.log(`  Avg Bet:    $${r.avgBet.toFixed(2)}`);
    console.log(`  Profile:    https://polymarket.com/profile/${r.wallet}`);
    console.log('');
  }

  // Earliest callers
  const early = impressive.filter(r => r.avgEntry < 0.35);
  console.log(`\n🎯 EARLIEST CALLERS (avg entry < 35%): ${early.length}\n`);
  early.sort((a, b) => a.avgEntry - b.avgEntry);

  for (const r of early.slice(0, 15)) {
    console.log(`${r.wallet}`);
    console.log(`  → Avg entry ${(r.avgEntry * 100).toFixed(0)}% | ${r.wins} wins | ${(r.avgReturn * 100).toFixed(0)}% return | $${r.totalPnL.toFixed(0)} PnL`);
  }

  console.log('\n=== ALL TRUE 100% WR ADDRESSES ===\n');
  for (const r of perfect) {
    console.log(r.wallet);
  }
}

main().catch(console.error);
