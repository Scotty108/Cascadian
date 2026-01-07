/**
 * Find TRUE INSIDERS in Fed/Tech/Econ markets - V3
 * Uses per-condition approach to avoid timeout
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

interface Position {
  wallet: string;
  question: string;
  cost_basis: number;
  entry_price: number;
  pnl: number;
}

async function main() {
  console.log('=== FINDING FED/TECH/ECON INSIDERS - V3 ===');
  console.log('Using per-condition approach to avoid timeout\n');

  // Step 1: Get Fed/Tech/Econ condition IDs (small query)
  console.log('Step 1: Finding Fed/Tech/Econ conditions...');

  const conditionsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id, question
      FROM pm_token_to_condition_map_v5
      WHERE
        lower(question) LIKE '%fed %'
        OR lower(question) LIKE '%federal reserve%'
        OR lower(question) LIKE '%interest rate%'
        OR lower(question) LIKE '%fomc%'
        OR lower(question) LIKE '%rate cut%'
        OR lower(question) LIKE '%rate hike%'
        OR lower(question) LIKE '% bps%'
        OR lower(question) LIKE '%earnings%'
        OR lower(question) LIKE '%tesla%'
        OR lower(question) LIKE '%nvidia%'
        OR lower(question) LIKE '%apple%'
        OR lower(question) LIKE '%google%'
        OR lower(question) LIKE '%microsoft%'
        OR lower(question) LIKE '%amazon%'
        OR lower(question) LIKE '%gdp%'
        OR lower(question) LIKE '%inflation%'
        OR lower(question) LIKE '%cpi %'
        OR lower(question) LIKE '%jobs report%'
        OR lower(question) LIKE '%unemployment%'
        OR lower(question) LIKE '%nonfarm%'
    `,
    format: 'JSONEachRow'
  });

  const conditions = await conditionsQuery.json() as any[];
  console.log(`Found ${conditions.length} Fed/Tech/Econ conditions\n`);

  // Sample questions
  console.log('Sample markets:');
  for (const c of conditions.slice(0, 8)) {
    console.log('  ' + c.question?.substring(0, 70));
  }
  console.log('');

  // Step 2: Get resolved conditions from this set
  const conditionIds = conditions.map(c => c.condition_id);

  console.log('Step 2: Checking which are resolved...');
  const resolvedQuery = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators, payout_denominator
      FROM pm_condition_resolutions FINAL
      WHERE is_deleted = 0
        AND payout_denominator != ''
        AND payout_denominator != '0'
        AND condition_id IN (${conditionIds.slice(0, 2000).map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });

  const resolved = await resolvedQuery.json() as any[];
  const resolvedIds = new Set(resolved.map((r: any) => r.condition_id));
  console.log(`${resolvedIds.size} are resolved\n`);

  // Step 3: For each resolved condition, find all wallet positions
  console.log('Step 3: Finding positions in these markets (batched)...\n');

  const walletPositions: Map<string, Position[]> = new Map();
  const resolvedArray = Array.from(resolvedIds);
  const batchSize = 100;

  for (let i = 0; i < Math.min(resolvedArray.length, 500); i += batchSize) {
    const batch = resolvedArray.slice(i, i + batchSize);

    try {
      const posQuery = await clickhouse.query({
        query: `
          SELECT
            wallet,
            cond,
            question,
            cost_basis,
            entry_price,
            pnl
          FROM (
            SELECT
              e.wallet as wallet,
              e.cond as cond,
              any(e.question) as question,
              sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
              sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
              sum(if(e.side = 'sell', e.usdc, 0)) +
                (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
                sum(if(e.side = 'buy', e.usdc, 0)) as pnl
            FROM (
              SELECT
                t.wallet as wallet,
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
                  any(trader_wallet) as wallet,
                  any(token_id) as token_id,
                  any(lower(side)) as side,
                  any(usdc_amount) / 1e6 as usdc,
                  any(token_amount) / 1e6 as tokens
                FROM pm_trader_events_v2
                WHERE is_deleted = 0
                GROUP BY event_id
              ) t
              INNER JOIN (
                SELECT token_id_dec, condition_id, outcome_index, question
                FROM pm_token_to_condition_map_v5
                WHERE condition_id IN (${batch.map(c => `'${c}'`).join(',')})
              ) tm ON t.token_id = tm.token_id_dec
              INNER JOIN (
                SELECT condition_id, payout_numerators, payout_denominator
                FROM pm_condition_resolutions FINAL
                WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
              ) r ON tm.condition_id = r.condition_id
            ) e
            GROUP BY e.wallet, e.cond
            HAVING cost_basis > 10
          )
          WHERE entry_price > 0.05 AND entry_price < 0.80
        `,
        format: 'JSONEachRow'
      });

      const positions = await posQuery.json() as any[];

      for (const pos of positions) {
        if (!walletPositions.has(pos.wallet)) {
          walletPositions.set(pos.wallet, []);
        }
        walletPositions.get(pos.wallet)!.push({
          wallet: pos.wallet,
          question: pos.question,
          cost_basis: pos.cost_basis,
          entry_price: pos.entry_price,
          pnl: pos.pnl
        });
      }

      console.log(`  Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(Math.min(resolvedArray.length, 500)/batchSize)}: ${positions.length} positions from ${batch.length} conditions`);

    } catch (err: any) {
      console.log(`  Batch ${Math.floor(i/batchSize) + 1} failed: ${err.message?.substring(0, 50)}`);
    }
  }

  console.log(`\nTotal: ${walletPositions.size} unique wallets with positions\n`);

  // Step 4: Find wallets with 100% win rate in Fed/Tech markets
  console.log('Step 4: Finding perfect records...\n');

  const perfectWallets: {
    wallet: string;
    positions: number;
    wins: number;
    avgEntry: number;
    avgReturn: number;
    totalPnl: number;
    sampleMarket: string;
  }[] = [];

  for (const [wallet, positions] of walletPositions) {
    if (positions.length < 3) continue; // Need at least 3 trades

    const wins = positions.filter(p => p.pnl > 0);
    const losses = positions.filter(p => p.pnl <= 0);

    // Must be 100% win rate
    if (losses.length > 0) continue;

    const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
    if (totalPnl <= 50) continue; // Must have made at least $50

    const avgEntry = positions.reduce((sum, p) => sum + p.entry_price, 0) / positions.length;
    const avgReturn = positions.reduce((sum, p) => sum + (p.pnl / p.cost_basis), 0) / positions.length;

    perfectWallets.push({
      wallet,
      positions: positions.length,
      wins: wins.length,
      avgEntry,
      avgReturn,
      totalPnl,
      sampleMarket: positions[0].question
    });
  }

  // Sort by number of wins
  perfectWallets.sort((a, b) => b.positions - a.positions);

  console.log(`🎯 Found ${perfectWallets.length} wallets with PERFECT records in Fed/Tech/Econ\n`);

  if (perfectWallets.length === 0) {
    console.log('No perfect records found. This is expected - true insiders are rare!');

    // Show near-perfect instead
    const nearPerfect: typeof perfectWallets = [];
    for (const [wallet, positions] of walletPositions) {
      if (positions.length < 3) continue;
      const wins = positions.filter(p => p.pnl > 0).length;
      const winRate = wins / positions.length;
      if (winRate >= 0.80) {
        const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
        if (totalPnl > 50) {
          nearPerfect.push({
            wallet,
            positions: positions.length,
            wins,
            avgEntry: positions.reduce((sum, p) => sum + p.entry_price, 0) / positions.length,
            avgReturn: positions.filter(p => p.pnl > 0).reduce((sum, p) => sum + (p.pnl / p.cost_basis), 0) / wins,
            totalPnl,
            sampleMarket: positions[0].question
          });
        }
      }
    }

    nearPerfect.sort((a, b) => (b.wins / b.positions) - (a.wins / a.positions));

    console.log(`\n📊 NEAR-PERFECT (80%+ WR) in Fed/Tech/Econ: ${nearPerfect.length}\n`);

    for (const w of nearPerfect.slice(0, 20)) {
      const wr = ((w.wins / w.positions) * 100).toFixed(0);
      console.log(`${w.wallet}`);
      console.log(`  Record: ${w.wins}/${w.positions} (${wr}% WR)`);
      console.log(`  Avg Entry: ${(w.avgEntry * 100).toFixed(0)}%`);
      console.log(`  Avg Return: ${(w.avgReturn * 100).toFixed(0)}%`);
      console.log(`  Total PnL: $${w.totalPnl.toFixed(0)}`);
      console.log(`  Sample: ${w.sampleMarket?.substring(0, 60)}...`);
      console.log(`  Profile: https://polymarket.com/profile/${w.wallet}`);
      console.log('');
    }
    return;
  }

  console.log('Wallet'.padEnd(44) + 'Wins'.padStart(6) + 'Entry'.padStart(8) + 'Return'.padStart(9) + 'PnL'.padStart(12));
  console.log('='.repeat(85));

  for (const w of perfectWallets.slice(0, 30)) {
    console.log(
      w.wallet.padEnd(44) +
      String(w.positions).padStart(6) +
      `${(w.avgEntry * 100).toFixed(0)}%`.padStart(8) +
      `${(w.avgReturn * 100).toFixed(0)}%`.padStart(9) +
      `$${w.totalPnl.toFixed(0)}`.padStart(12)
    );
  }

  console.log('\n\n🔥 TOP FED/TECH INSIDERS:\n');

  for (const w of perfectWallets.slice(0, 15)) {
    console.log(w.wallet);
    console.log(`  Perfect Record: ${w.wins}/${w.positions} (100% WR in Fed/Tech/Econ)`);
    console.log(`  Avg Entry:      ${(w.avgEntry * 100).toFixed(1)}%`);
    console.log(`  Avg Return:     ${(w.avgReturn * 100).toFixed(0)}% per trade`);
    console.log(`  Total PnL:      $${w.totalPnl.toFixed(2)}`);
    console.log(`  Sample Market:  ${w.sampleMarket?.substring(0, 70)}...`);
    console.log(`  Profile:        https://polymarket.com/profile/${w.wallet}`);
    console.log('');
  }

  // Most suspicious: early entry + big returns
  const suspicious = perfectWallets.filter(w =>
    w.avgEntry < 0.50 && w.avgReturn >= 0.50
  );

  console.log(`\n🎯 MOST SUSPICIOUS (entry < 50%, return >= 50%): ${suspicious.length}\n`);

  for (const w of suspicious) {
    console.log(`${w.wallet}`);
    console.log(`  → ${w.wins} perfect calls at avg ${(w.avgEntry * 100).toFixed(0)}% entry`);
    console.log(`  → ${(w.avgReturn * 100).toFixed(0)}% avg return, $${w.totalPnl.toFixed(0)} PnL`);
    console.log(`  → ${w.sampleMarket?.substring(0, 60)}...`);
  }

  console.log('\n=== ALL FED/TECH INSIDER ADDRESSES ===\n');
  for (const w of perfectWallets) {
    console.log(w.wallet);
  }
}

main().catch(console.error);
