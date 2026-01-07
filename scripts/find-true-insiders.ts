/**
 * Find TRUE INSIDERS / SUPERFORECASTERS
 *
 * Calculate entry prices directly from raw trades since precomputed table
 * doesn't have this data. Uses the top 100% WR wallets from metrics.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

interface WalletAnalysis {
  wallet: string;
  positions: number;
  wins: number;
  winRate: number;
  avgEntryOnWins: number;
  avgPriceSwing: number;
  bestEarlyEntry: number;
  earlyWins: number;
  totalPnL: number;
  avgBet: number;
  arbPct: number;
}

async function analyzeWallet(wallet: string): Promise<WalletAnalysis | null> {
  try {
    // Get position-level data with entry prices
    const result = await clickhouse.query({
      query: `
        SELECT
          cond,
          cost_basis,
          tokens_bought,
          if(tokens_bought > 0, cost_basis / tokens_bought, 0) as entry_price,
          payout_value,
          payout_value - cost_basis as pnl,
          if(payout_value > cost_basis, 1, 0) as is_win
        FROM (
          SELECT
            e.cond as cond,
            sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
            sum(if(e.side = 'buy', e.tokens, 0)) as tokens_bought,
            sum(if(e.side = 'sell', e.usdc, 0)) +
              (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) as payout_value
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
                any(trader_wallet) as wallet,
                any(token_id) as token_id,
                any(lower(side)) as side,
                any(usdc_amount) / 1e6 as usdc,
                any(token_amount) / 1e6 as tokens
              FROM pm_trader_events_v2
              WHERE trader_wallet = {wallet:String} AND is_deleted = 0
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
          HAVING cost_basis > 1
        )
        WHERE tokens_bought > 0
      `,
      format: 'JSONEachRow',
      query_params: { wallet }
    });

    const positions = await result.json() as any[];
    if (positions.length < 8) return null;

    const wins = positions.filter((p) => p.is_win === 1);
    const winRate = wins.length / positions.length;

    if (winRate < 0.85) return null;

    const totalPnL = positions.reduce((sum, p) => sum + p.pnl, 0);
    if (totalPnL <= 0) return null;

    // Calculate entry price stats
    const winEntries = wins
      .map(p => p.entry_price)
      .filter(e => e > 0 && e < 1);

    const avgEntryOnWins = winEntries.length > 0
      ? winEntries.reduce((a, b) => a + b, 0) / winEntries.length
      : 0;

    const avgPriceSwing = avgEntryOnWins > 0 ? 1 - avgEntryOnWins : 0;
    const bestEarlyEntry = winEntries.length > 0 ? Math.min(...winEntries) : 1;
    const earlyWins = winEntries.filter(e => e < 0.50).length;
    const avgBet = positions.reduce((sum, p) => sum + p.cost_basis, 0) / positions.length;

    // Check arb volume
    const arbCheck = await clickhouse.query({
      query: `
        SELECT
          sum(if(usdc / nullIf(tokens, 0) >= 0.90, usdc, 0)) as arb_vol,
          sum(usdc) as total_vol
        FROM (
          SELECT event_id, any(usdc_amount)/1e6 as usdc, any(token_amount)/1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = {wallet:String} AND lower(side) = 'buy' AND is_deleted = 0
          GROUP BY event_id
        )
        WHERE tokens > 0 AND usdc > 0
      `,
      format: 'JSONEachRow',
      query_params: { wallet }
    });
    const arbData = (await arbCheck.json() as any[])[0];
    const arbPct = arbData && arbData.total_vol > 0
      ? (arbData.arb_vol / arbData.total_vol) * 100
      : 0;

    if (arbPct >= 50) return null;

    return {
      wallet,
      positions: positions.length,
      wins: wins.length,
      winRate,
      avgEntryOnWins,
      avgPriceSwing,
      bestEarlyEntry,
      earlyWins,
      totalPnL,
      avgBet,
      arbPct
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('=== TRUE INSIDER / SUPERFORECASTER DETECTION ===');
  console.log('Analyzing wallets with 85%+ WR from metrics table\n');

  // Get candidate wallets from metrics
  const candidates = await clickhouse.query({
    query: `
      SELECT wallet_address as wallet, win_rate, realized_pnl
      FROM pm_copy_trading_metrics_v1 FINAL
      WHERE win_rate >= 0.85
        AND resolved_positions >= 8
        AND realized_pnl > 50
        AND is_phantom = 0
      ORDER BY win_rate DESC, realized_pnl DESC
      LIMIT 200
    `,
    format: 'JSONEachRow'
  });
  const candidateList = await candidates.json() as any[];
  console.log(`Analyzing ${candidateList.length} candidates...\n`);

  const insiders: WalletAnalysis[] = [];
  let processed = 0;

  for (const c of candidateList) {
    processed++;
    const analysis = await analyzeWallet(c.wallet);

    if (analysis && analysis.avgEntryOnWins > 0) {
      insiders.push(analysis);
      console.log(`✓ ${analysis.wallet.substring(0, 12)}... WR:${(analysis.winRate * 100).toFixed(0)}% Entry:${(analysis.avgEntryOnWins * 100).toFixed(0)}% Swing:${(analysis.avgPriceSwing * 100).toFixed(0)}% PnL:$${analysis.totalPnL.toFixed(0)}`);
    }

    if (processed % 20 === 0) {
      console.log(`  [Processed ${processed}/${candidateList.length}, found ${insiders.length} insiders]`);
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n🎯 TRUE INSIDERS/SUPERFORECASTERS: ${insiders.length} wallets\n`);

  if (insiders.length === 0) {
    console.log('No insiders found. The metrics table may have limited coverage.');
    return;
  }

  // Sort by price swing (biggest = earliest callers)
  insiders.sort((a, b) => b.avgPriceSwing - a.avgPriceSwing);

  console.log('Wallet'.padEnd(44) + 'WR%'.padStart(6) + 'Swing'.padStart(8) + 'Entry'.padStart(8) + 'Early'.padStart(7) + 'PnL'.padStart(12));
  console.log('='.repeat(90));

  for (const r of insiders.slice(0, 50)) {
    console.log(
      r.wallet.padEnd(44) +
      `${(r.winRate * 100).toFixed(0)}%`.padStart(6) +
      `${(r.avgPriceSwing * 100).toFixed(0)}%`.padStart(8) +
      `${(r.avgEntryOnWins * 100).toFixed(0)}%`.padStart(8) +
      String(r.earlyWins).padStart(7) +
      `$${r.totalPnL.toFixed(0)}`.padStart(12)
    );
  }

  // Find the BEST insiders (large swings + high win rate)
  const elites = insiders.filter(r =>
    r.avgPriceSwing >= 0.25 &&
    r.winRate >= 0.90 &&
    r.earlyWins >= 2
  );

  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n🔥 ELITE INSIDERS (25%+ swing, 90%+ WR, 2+ early wins): ${elites.length}\n`);

  for (const r of elites) {
    console.log(r.wallet);
    console.log(`  Win Rate:      ${(r.winRate * 100).toFixed(1)}% (${r.wins}/${r.positions})`);
    console.log(`  Avg Entry:     ${(r.avgEntryOnWins * 100).toFixed(1)}% (on winning trades)`);
    console.log(`  Price Swing:   ${(r.avgPriceSwing * 100).toFixed(1)}% (captured movement)`);
    console.log(`  Best Entry:    ${(r.bestEarlyEntry * 100).toFixed(1)}% (lowest entry that won)`);
    console.log(`  Early Wins:    ${r.earlyWins} (entered < 50% and won)`);
    console.log(`  Total PnL:     $${r.totalPnL.toFixed(2)}`);
    console.log(`  Avg Bet:       $${r.avgBet.toFixed(2)}`);
    console.log(`  Arb Volume:    ${r.arbPct.toFixed(1)}%`);
    console.log(`  Profile:       https://polymarket.com/profile/${r.wallet}`);
    console.log('');
  }

  console.log('\n=== ALL INSIDER ADDRESSES ===\n');
  for (const r of insiders) {
    console.log(r.wallet);
  }
}

main().catch(console.error);
