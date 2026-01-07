/**
 * Find Fed/Inflation/CPI Insiders - Per-Wallet Approach
 * Query each wallet individually to avoid timeout
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

interface InsiderPosition {
  question: string;
  cost_basis: number;
  entry_price: number;
  pnl: number;
}

interface WalletResult {
  wallet: string;
  positions: InsiderPosition[];
  wins: number;
  losses: number;
  totalPnl: number;
  avgEntry: number;
  avgReturn: number;
}

async function analyzeWalletForInsiderMarkets(wallet: string): Promise<WalletResult | null> {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          question,
          cost_basis,
          entry_price,
          pnl
        FROM (
          SELECT
            any(e.question) as question,
            sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
            sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
            sum(if(e.side = 'sell', e.usdc, 0)) +
              (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
              sum(if(e.side = 'buy', e.usdc, 0)) as pnl
          FROM (
            SELECT
              tm.condition_id as cond,
              tm.question as question,
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
            INNER JOIN (
              SELECT token_id_dec, condition_id, outcome_index, question
              FROM pm_token_to_condition_map_v5
              WHERE
                -- Fed/Interest Rate (true insider knowledge)
                lower(question) LIKE '%fomc%'
                OR lower(question) LIKE '%federal reserve%'
                OR lower(question) LIKE '%rate cut%'
                OR lower(question) LIKE '%rate hike%'
                OR (lower(question) LIKE '%powell%' AND lower(question) NOT LIKE '%norman powell%')
                OR lower(question) LIKE '% bps%'
                OR lower(question) LIKE '%basis point%'
                -- Economic data (BLS insider knowledge)
                OR lower(question) LIKE '%cpi %'
                OR lower(question) LIKE '%inflation %'
                OR lower(question) LIKE '%gdp %'
                OR lower(question) LIKE '%jobs report%'
                OR lower(question) LIKE '%unemployment rate%'
                OR lower(question) LIKE '%nonfarm payroll%'
                OR lower(question) LIKE '%jobless claim%'
                -- Tech earnings (corporate insider)
                OR lower(question) LIKE '%earnings%'
                OR lower(question) LIKE '%revenue %'
                OR lower(question) LIKE '% eps %'
            ) tm ON t.token_id = tm.token_id_dec
            INNER JOIN (
              SELECT condition_id, payout_numerators, payout_denominator
              FROM pm_condition_resolutions FINAL
              WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
            ) r ON tm.condition_id = r.condition_id
          ) e
          GROUP BY e.cond
          HAVING cost_basis > 10
        )
        WHERE entry_price > 0.05 AND entry_price < 0.80
      `,
      format: 'JSONEachRow'
    });

    const positions = await result.json() as InsiderPosition[];

    if (positions.length < 2) return null; // Need at least 2 insider-market trades

    const wins = positions.filter(p => p.pnl > 0);
    const losses = positions.filter(p => p.pnl <= 0);
    const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

    if (totalPnl <= 50) return null;

    const avgEntry = positions.reduce((sum, p) => sum + p.entry_price, 0) / positions.length;
    const avgReturn = wins.length > 0
      ? wins.reduce((sum, p) => sum + (p.pnl / p.cost_basis), 0) / wins.length
      : 0;

    return {
      wallet,
      positions,
      wins: wins.length,
      losses: losses.length,
      totalPnl,
      avgEntry,
      avgReturn
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  console.log('=== FINDING FED/INFLATION/CPI INSIDERS (Per-Wallet Approach) ===');
  console.log('Checking wallets individually to avoid timeout\n');

  // Get candidate wallets with high win rates from precomputed table
  console.log('Step 1: Getting high-performance wallet candidates...');

  const candidates = await clickhouse.query({
    query: `
      SELECT DISTINCT wallet
      FROM pm_wallet_condition_realized_v1
      GROUP BY wallet
      HAVING
        count() >= 5
        AND sum(is_win) >= 4
        AND sum(realized_pnl) > 100
      ORDER BY sum(is_win) / count() DESC, sum(realized_pnl) DESC
      LIMIT 3000
    `,
    format: 'JSONEachRow'
  });

  const candidateList = await candidates.json() as any[];
  console.log(`Found ${candidateList.length} candidate wallets\n`);

  console.log('Step 2: Checking each wallet for Fed/Inflation/Earnings trades...\n');

  const insiders: WalletResult[] = [];
  let processed = 0;
  let withInsiderTrades = 0;

  for (const c of candidateList) {
    processed++;

    const result = await analyzeWalletForInsiderMarkets(c.wallet);

    if (result) {
      withInsiderTrades++;
      if (result.losses === 0) {
        insiders.push(result);
        console.log(`✓ ${result.wallet.substring(0, 12)}... ${result.wins} insider wins, $${result.totalPnl.toFixed(0)} PnL`);
      }
    }

    if (processed % 200 === 0) {
      console.log(`  [Processed ${processed}/${candidateList.length}, found ${insiders.length} 100% WR insiders]`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`\nTotal processed: ${processed}`);
  console.log(`With insider-market trades: ${withInsiderTrades}`);
  console.log(`With 100% WR in insider markets: ${insiders.length}\n`);

  if (insiders.length === 0) {
    console.log('No wallets found with 100% WR in Fed/Inflation/Earnings markets.');
    console.log('This confirms that true insider trading is rare or non-existent!');
    return;
  }

  // Sort by number of wins
  insiders.sort((a, b) => b.wins - a.wins);

  console.log('🎯 TRUE INSIDERS (100% WR in Fed/Inflation/Earnings):\n');
  console.log('Wallet'.padEnd(44) + 'Wins'.padStart(6) + 'Entry'.padStart(8) + 'Return'.padStart(9) + 'PnL'.padStart(12));
  console.log('='.repeat(85));

  for (const w of insiders) {
    console.log(
      w.wallet.padEnd(44) +
      `${w.wins}`.padStart(6) +
      `${(w.avgEntry * 100).toFixed(0)}%`.padStart(8) +
      `${(w.avgReturn * 100).toFixed(0)}%`.padStart(9) +
      `$${w.totalPnl.toFixed(0)}`.padStart(12)
    );
  }

  console.log('\n\n🔥 DETAILED INSIDER PROFILES:\n');

  for (const w of insiders.slice(0, 20)) {
    console.log(w.wallet);
    console.log(`  Perfect Record: ${w.wins}/${w.wins} (100% WR in Fed/Inflation/Earnings)`);
    console.log(`  Avg Entry:      ${(w.avgEntry * 100).toFixed(1)}%`);
    console.log(`  Avg Return:     ${(w.avgReturn * 100).toFixed(0)}% per trade`);
    console.log(`  Total PnL:      $${w.totalPnl.toFixed(2)}`);
    console.log(`  Profile:        https://polymarket.com/profile/${w.wallet}`);
    console.log('  Insider Trades:');
    for (const p of w.positions) {
      const status = p.pnl > 0 ? '✓' : '✗';
      console.log(`    ${status} ${p.question?.substring(0, 55)}...`);
      console.log(`      Entry: ${(p.entry_price * 100).toFixed(0)}% → PnL: $${p.pnl.toFixed(0)}`);
    }
    console.log('');
  }

  // Most suspicious: early entry + big returns
  const suspicious = insiders.filter(w =>
    w.avgEntry < 0.50 && w.avgReturn >= 0.50
  );

  if (suspicious.length > 0) {
    console.log(`\n🎯 MOST SUSPICIOUS (entry < 50%, return >= 50%): ${suspicious.length}\n`);
    for (const w of suspicious) {
      console.log(`${w.wallet}`);
      console.log(`  → ${w.wins} perfect insider calls at avg ${(w.avgEntry * 100).toFixed(0)}% entry`);
      console.log(`  → ${(w.avgReturn * 100).toFixed(0)}% avg return, $${w.totalPnl.toFixed(0)} PnL`);
    }
  }

  console.log('\n=== ALL INSIDER WALLET ADDRESSES ===\n');
  for (const w of insiders) {
    console.log(w.wallet);
  }
}

main().catch(console.error);
