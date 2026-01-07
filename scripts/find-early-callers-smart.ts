/**
 * Find early callers using smart 2-step approach:
 * 1. Get candidates from precomputed table (fast)
 * 2. Verify entry prices for each candidate (targeted)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

interface WalletAnalysis {
  wallet: string;
  positions: number;
  wins: number;
  winRate: number;
  earlyWins: number;
  avgWinEntry: number;
  avgPriceSwing: number;
  bestEarlyCall: number;
  totalPnL: number;
  avgBet: number;
}

async function analyzeWalletEntries(wallet: string): Promise<WalletAnalysis | null> {
  try {
    // Get position-level data with entry prices for this specific wallet
    const result = await clickhouse.query({
      query: `
        SELECT
          cond,
          cost_basis,
          entry_price,
          pnl,
          if(pnl > 0, 1, 0) as is_win,
          if(pnl > 0 AND entry_price < 0.50, 1, 0) as is_early_win
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
          HAVING cost_basis > 1 AND sum(if(e.side = 'buy', e.tokens, -e.tokens)) >= 0
        )
        WHERE entry_price > 0 AND entry_price < 1
      `,
      format: 'JSONEachRow'
    });

    const positions = await result.json() as any[];
    if (positions.length < 5) return null;

    const wins = positions.filter((p: any) => p.is_win === 1);
    const earlyWins = positions.filter((p: any) => p.is_early_win === 1);
    const winRate = wins.length / positions.length;

    if (winRate < 0.60 || earlyWins.length < 2) return null;

    const totalPnL = positions.reduce((sum: number, p: any) => sum + p.pnl, 0);
    if (totalPnL <= 0) return null;

    const winEntries = wins.map((p: any) => p.entry_price);
    const avgWinEntry = winEntries.length > 0
      ? winEntries.reduce((a: number, b: number) => a + b, 0) / winEntries.length
      : 0;

    const earlyWinEntries = earlyWins.map((p: any) => p.entry_price);
    const bestEarlyCall = earlyWinEntries.length > 0 ? Math.min(...earlyWinEntries) : 1;

    const avgBet = positions.reduce((sum: number, p: any) => sum + p.cost_basis, 0) / positions.length;

    return {
      wallet,
      positions: positions.length,
      wins: wins.length,
      winRate,
      earlyWins: earlyWins.length,
      avgWinEntry,
      avgPriceSwing: 1 - avgWinEntry,
      bestEarlyCall,
      totalPnL,
      avgBet
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('=== FINDING EARLY CALLERS / INSIDERS ===');
  console.log('Step 1: Get candidate wallets from precomputed table\n');

  // Get candidates from precomputed table (high WR, positive PnL)
  const candidates = await clickhouse.query({
    query: `
      SELECT
        wallet,
        count() as positions,
        sum(is_win) as wins,
        sum(is_win) / count() as win_rate,
        sum(realized_pnl) as total_pnl,
        avg(cost_basis) as avg_bet
      FROM pm_wallet_condition_realized_v1
      GROUP BY wallet
      HAVING
        count() >= 5
        AND sum(is_win) / count() >= 0.60
        AND sum(realized_pnl) > 50
        AND avg(cost_basis) >= 5
      ORDER BY win_rate DESC, total_pnl DESC
      LIMIT 500
    `,
    format: 'JSONEachRow'
  });

  const candidateList = await candidates.json() as any[];
  console.log(`Found ${candidateList.length} candidate wallets\n`);
  console.log('Step 2: Analyzing entry prices for each candidate...\n');

  const insiders: WalletAnalysis[] = [];
  let processed = 0;

  for (const c of candidateList) {
    processed++;
    const analysis = await analyzeWalletEntries(c.wallet);

    if (analysis) {
      insiders.push(analysis);
      console.log(`✓ ${analysis.wallet.substring(0, 12)}... WR:${(analysis.winRate * 100).toFixed(0)}% Early:${analysis.earlyWins} Entry:${(analysis.avgWinEntry * 100).toFixed(0)}% PnL:$${analysis.totalPnL.toFixed(0)}`);
    }

    if (processed % 50 === 0) {
      console.log(`  [Processed ${processed}/${candidateList.length}, found ${insiders.length} insiders]`);
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n🎯 EARLY CALLERS / INSIDERS: ${insiders.length} wallets\n`);

  if (insiders.length === 0) {
    console.log('No insiders found.');
    return;
  }

  // Sort by early wins (most early wins = most suspicious)
  insiders.sort((a, b) => b.earlyWins - a.earlyWins);

  console.log('Wallet'.padEnd(44) + 'WR%'.padStart(6) + 'Early'.padStart(7) + 'Entry'.padStart(8) + 'Swing'.padStart(8) + 'PnL'.padStart(12));
  console.log('='.repeat(90));

  for (const r of insiders.slice(0, 50)) {
    console.log(
      r.wallet.padEnd(44) +
      `${(r.winRate * 100).toFixed(0)}%`.padStart(6) +
      String(r.earlyWins).padStart(7) +
      `${(r.avgWinEntry * 100).toFixed(0)}%`.padStart(8) +
      `${(r.avgPriceSwing * 100).toFixed(0)}%`.padStart(8) +
      `$${r.totalPnL.toFixed(0)}`.padStart(12)
    );
  }

  // Find most suspicious (low entry + high early wins + high WR)
  const suspicious = insiders.filter(r =>
    r.avgWinEntry < 0.50 &&  // Avg entry < 50%
    r.earlyWins >= 3 &&     // 3+ early wins
    r.winRate >= 0.70       // 70%+ WR
  );

  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n🔥 MOST SUSPICIOUS (entry < 50%, 3+ early wins, 70%+ WR): ${suspicious.length}\n`);

  // Sort by avg entry (lowest = called it earliest)
  suspicious.sort((a, b) => a.avgWinEntry - b.avgWinEntry);

  for (const r of suspicious.slice(0, 20)) {
    console.log(r.wallet);
    console.log(`  Win Rate:      ${(r.winRate * 100).toFixed(1)}% (${r.wins}/${r.positions})`);
    console.log(`  Early Wins:    ${r.earlyWins} (bought < 50% and won)`);
    console.log(`  Avg Entry:     ${(r.avgWinEntry * 100).toFixed(1)}% (on wins) ← CALLED IT EARLY`);
    console.log(`  Price Swing:   ${(r.avgPriceSwing * 100).toFixed(1)}% captured`);
    console.log(`  Best Call:     ${(r.bestEarlyCall * 100).toFixed(1)}% entry`);
    console.log(`  Total PnL:     $${r.totalPnL.toFixed(2)}`);
    console.log(`  Avg Bet:       $${r.avgBet.toFixed(2)}`);
    console.log(`  Profile:       https://polymarket.com/profile/${r.wallet}`);
    console.log('');
  }

  // ELITE tier: highest conviction calls
  const elite = suspicious.filter(r =>
    r.avgWinEntry < 0.40 &&  // Avg entry < 40%
    r.earlyWins >= 4 &&      // 4+ early wins
    r.winRate >= 0.75        // 75%+ WR
  );

  console.log(`\n🏆 ELITE INSIDERS (entry < 40%, 4+ early wins, 75%+ WR): ${elite.length}\n`);

  for (const r of elite) {
    console.log(`${r.wallet} ← LIKELY INSIDER/SUPERFORECASTER`);
    console.log(`  ${r.earlyWins} early wins at avg ${(r.avgWinEntry * 100).toFixed(0)}% entry`);
    console.log(`  Best call: entered at ${(r.bestEarlyCall * 100).toFixed(0)}%`);
    console.log(`  Total PnL: $${r.totalPnL.toFixed(0)}`);
    console.log('');
  }

  console.log('\n=== ALL INSIDER ADDRESSES ===\n');
  for (const r of insiders) {
    console.log(r.wallet);
  }
}

main().catch(console.error);
