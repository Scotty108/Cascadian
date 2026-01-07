/**
 * Find INSIDER / SUPERFORECASTER Wallets
 *
 * These are wallets that:
 * - Consistently enter positions EARLY (when odds are far from resolution)
 * - Win at extremely high rates (90%+)
 * - Are NOT arbers (don't buy at 90%+ odds)
 *
 * Key metric: "Price Movement Captured" = resolution_price - entry_price
 * - Insider buys at 30%, market resolves to 100% = captured 70% movement
 * - Arber buys at 95%, market resolves to 100% = captured 5% movement
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== INSIDER / SUPERFORECASTER DETECTION ===');
  console.log('Finding wallets that consistently call outcomes EARLY\n');

  // Step 1: Get position-level data with entry prices and outcomes
  console.log('Querying position-level data with price movements...\n');

  const query = `
    SELECT
      wallet,
      count() as positions,
      sum(is_win) as wins,
      sum(is_win) / count() as win_rate,
      -- Average entry price on WINNING trades
      avgIf(entry_price, is_win = 1) as avg_win_entry,
      -- Average price movement captured on wins (1.0 - entry_price)
      avgIf(1.0 - entry_price, is_win = 1) as avg_price_swing,
      -- Minimum entry price on wins (their best early call)
      minIf(entry_price, is_win = 1) as best_early_entry,
      -- How many trades were "early" (entry < 0.50 that won)
      sumIf(1, is_win = 1 AND entry_price < 0.50) as early_wins,
      -- Total PnL
      sum(pnl) as total_pnl,
      -- Average bet size
      avg(cost_basis) as avg_bet
    FROM (
      SELECT
        wallet,
        cond,
        cost_basis,
        cost_basis / nullIf(tokens_bought, 0) as entry_price,
        if(payout_value > cost_basis, 1, 0) as is_win,
        payout_value - cost_basis as pnl
      FROM (
        SELECT
          e.wallet as wallet,
          e.cond as cond,
          sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
          sum(if(e.side = 'buy', e.tokens, 0)) as tokens_bought,
          sum(if(e.side = 'sell', e.usdc, 0)) as sell_proceeds,
          sum(if(e.side = 'buy', e.tokens, -e.tokens)) as net_tokens,
          any(e.payout) as payout_rate,
          -- Payout value = sell proceeds + (remaining tokens * payout rate)
          sum(if(e.side = 'sell', e.usdc, 0)) +
            (sum(if(e.side = 'buy', e.tokens, -e.tokens)) * any(e.payout)) as payout_value
        FROM (
          SELECT
            t.wallet as wallet,
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
            WHERE is_deleted = 0
            GROUP BY event_id
          ) t
          INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
          INNER JOIN (
            SELECT condition_id, payout_numerators, payout_denominator
            FROM pm_condition_resolutions FINAL
            WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
          ) r ON tm.condition_id = r.condition_id
        ) e
        GROUP BY e.wallet, e.cond
        HAVING cost_basis > 1 AND net_tokens >= 0
      )
      WHERE tokens_bought > 0
    )
    GROUP BY wallet
    HAVING
      positions >= 8
      AND sum(is_win) / count() >= 0.85
      AND sum(pnl) > 0
      AND avg(cost_basis) >= 5
    ORDER BY avg_price_swing DESC, win_rate DESC
    LIMIT 200
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const candidates = await result.json() as any[];

    console.log(`Found ${candidates.length} high win-rate candidates\n`);

    if (candidates.length === 0) {
      console.log('No candidates found. Trying simpler query...');
      return;
    }

    // Step 2: Filter out arbers using volume-weighted check
    console.log('Filtering out arbers (checking volume at 90%+ odds)...\n');

    const insiders: any[] = [];

    for (const c of candidates) {
      // Check what % of their volume is at 90%+ odds
      const arbCheck = await clickhouse.query({
        query: `
          SELECT
            sum(if(usdc / nullIf(tokens, 0) >= 0.90, usdc, 0)) as arb_vol,
            sum(usdc) as total_vol
          FROM (
            SELECT event_id, any(usdc_amount)/1e6 as usdc, any(token_amount)/1e6 as tokens
            FROM pm_trader_events_v2
            WHERE trader_wallet = '${c.wallet}' AND lower(side) = 'buy' AND is_deleted = 0
            GROUP BY event_id
          )
          WHERE tokens > 0 AND usdc > 0
        `,
        format: 'JSONEachRow'
      });
      const arbData = (await arbCheck.json() as any[])[0];
      const arbPct = arbData.total_vol > 0 ? (arbData.arb_vol / arbData.total_vol * 100) : 0;

      if (arbPct >= 50) {
        continue; // Skip arbers
      }

      insiders.push({
        ...c,
        arb_pct: arbPct
      });

      // Show progress
      if (insiders.length <= 5 || insiders.length % 10 === 0) {
        console.log(`✓ ${c.wallet.substring(0, 12)}... WR:${(c.win_rate*100).toFixed(0)}% AvgSwing:${(c.avg_price_swing*100).toFixed(0)}% EarlyWins:${c.early_wins} Arb:${arbPct.toFixed(0)}%`);
      }
    }

    console.log(`\n${'='.repeat(100)}`);
    console.log(`\n🎯 TRUE INSIDERS/SUPERFORECASTERS: ${insiders.length} wallets\n`);

    if (insiders.length === 0) {
      console.log('No insiders found after filtering arbers.');
      return;
    }

    // Sort by avg price swing (bigger swings = called it earlier)
    insiders.sort((a, b) => b.avg_price_swing - a.avg_price_swing);

    console.log('Wallet'.padEnd(44) + 'WR%'.padStart(6) + 'Swing'.padStart(8) + 'Early'.padStart(7) + 'BestEntry'.padStart(10) + 'Arb%'.padStart(7) + 'PnL'.padStart(12));
    console.log('='.repeat(100));

    for (const r of insiders.slice(0, 50)) {
      console.log(
        r.wallet.padEnd(44) +
        `${(r.win_rate * 100).toFixed(0)}%`.padStart(6) +
        `${(r.avg_price_swing * 100).toFixed(0)}%`.padStart(8) +
        String(r.early_wins).padStart(7) +
        `${(r.best_early_entry * 100).toFixed(0)}%`.padStart(10) +
        `${r.arb_pct.toFixed(0)}%`.padStart(7) +
        `$${r.total_pnl.toFixed(0)}`.padStart(12)
      );
    }

    // Detailed analysis of top insiders
    console.log('\n=== TOP 15 INSIDER/SUPERFORECASTER PROFILES ===\n');

    for (let i = 0; i < Math.min(15, insiders.length); i++) {
      const r = insiders[i];
      console.log(`${i + 1}. ${r.wallet}`);
      console.log(`   Win Rate:        ${(r.win_rate * 100).toFixed(1)}% (${r.wins}/${r.positions} positions)`);
      console.log(`   Avg Price Swing: ${(r.avg_price_swing * 100).toFixed(1)}% (how much price moved in their favor)`);
      console.log(`   Avg Entry Price: ${(r.avg_win_entry * 100).toFixed(1)}% (on winning trades)`);
      console.log(`   Best Early Call: Entered at ${(r.best_early_entry * 100).toFixed(1)}% odds and WON`);
      console.log(`   Early Wins:      ${r.early_wins} trades entered below 50% odds that won`);
      console.log(`   Arb Volume:      ${r.arb_pct.toFixed(1)}% (low = NOT an arber)`);
      console.log(`   Total PnL:       $${r.total_pnl.toFixed(2)}`);
      console.log(`   Avg Bet Size:    $${r.avg_bet.toFixed(2)}`);
      console.log(`   Polymarket:      https://polymarket.com/profile/${r.wallet}`);
      console.log('');
    }

    // Find the most suspicious ones (very early entries with high win rate)
    const suspicious = insiders.filter(r =>
      r.avg_price_swing >= 0.30 && // Captured 30%+ price movement on average
      r.early_wins >= 3 &&         // At least 3 trades entered below 50%
      r.win_rate >= 0.90           // 90%+ win rate
    );

    console.log('=== MOST SUSPICIOUS (30%+ avg swing, 3+ early wins, 90%+ WR) ===\n');
    console.log(`Found ${suspicious.length} highly suspicious wallets:\n`);

    for (const r of suspicious) {
      console.log(`${r.wallet}`);
      console.log(`  → Captured ${(r.avg_price_swing * 100).toFixed(0)}% price movement on average`);
      console.log(`  → ${r.early_wins} wins from entries below 50% odds`);
      console.log(`  → Best call: entered at ${(r.best_early_entry * 100).toFixed(0)}% and won`);
      console.log(`  → ${(r.win_rate * 100).toFixed(0)}% win rate over ${r.positions} positions`);
      console.log('');
    }

    console.log('=== ALL INSIDER ADDRESSES ===\n');
    for (const r of insiders) {
      console.log(r.wallet);
    }

  } catch (err: any) {
    console.error('Query failed:', err.message);
    if (err.message.includes('Timeout')) {
      console.log('\nQuery timed out. Try running with longer timeout.');
    }
  }
}

main().catch(console.error);
