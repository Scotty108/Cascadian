/**
 * Find TRUE INSIDERS in Fed/Inflation/CPI/Earnings markets
 * These are markets where actual insider knowledge is most plausible
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== FINDING TRUE INSIDERS (Fed/Inflation/CPI/Earnings) ===');
  console.log('Markets where insider knowledge is most plausible\n');

  // Step 1: Get STRICTLY insider-knowledge plausible markets
  console.log('Step 1: Finding strictly insider-knowledge markets...');

  const conditionsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id, question
      FROM pm_token_to_condition_map_v5
      WHERE
        -- Fed/Interest Rate decisions (actual FOMC insider knowledge)
        lower(question) LIKE '%fomc%'
        OR lower(question) LIKE '%federal reserve%'
        OR lower(question) LIKE '%rate cut%'
        OR lower(question) LIKE '%rate hike%'
        OR lower(question) LIKE '%powell%'
        OR lower(question) LIKE '% bps%'
        OR lower(question) LIKE '%basis point%'
        -- Economic data releases (BLS/Commerce insider knowledge)
        OR lower(question) LIKE '%cpi %'
        OR lower(question) LIKE '%inflation %'
        OR lower(question) LIKE '%gdp %'
        OR lower(question) LIKE '%jobs report%'
        OR lower(question) LIKE '%unemployment rate%'
        OR lower(question) LIKE '%nonfarm payroll%'
        OR lower(question) LIKE '%jobless claim%'
        -- Tech earnings (actual corporate insider knowledge)
        OR (lower(question) LIKE '%earnings%' AND (
          lower(question) LIKE '%apple%'
          OR lower(question) LIKE '%nvidia%'
          OR lower(question) LIKE '%tesla%'
          OR lower(question) LIKE '%google%'
          OR lower(question) LIKE '%microsoft%'
          OR lower(question) LIKE '%amazon%'
          OR lower(question) LIKE '%meta %'
        ))
        OR lower(question) LIKE '%revenue%'
        OR lower(question) LIKE '% eps %'
    `,
    format: 'JSONEachRow'
  });

  const conditions = await conditionsQuery.json() as any[];
  console.log(`Found ${conditions.length} insider-knowledge markets\n`);

  // Sample questions
  console.log('Sample markets (these are where insider knowledge is plausible):');
  for (const c of conditions.slice(0, 15)) {
    console.log('  ' + c.question?.substring(0, 75));
  }
  console.log('');

  const conditionIds = conditions.map(c => c.condition_id);
  if (conditionIds.length === 0) {
    console.log('No conditions found');
    return;
  }

  // Step 2: Get resolved conditions
  console.log('Step 2: Checking which are resolved...');
  const resolvedQuery = await clickhouse.query({
    query: `
      SELECT condition_id
      FROM pm_condition_resolutions FINAL
      WHERE is_deleted = 0
        AND payout_denominator != ''
        AND payout_denominator != '0'
        AND condition_id IN (${conditionIds.slice(0, 1000).map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });

  const resolved = await resolvedQuery.json() as any[];
  const resolvedIds = resolved.map((r: any) => r.condition_id);
  console.log(`${resolvedIds.length} are resolved\n`);

  if (resolvedIds.length === 0) {
    console.log('No resolved conditions found');
    return;
  }

  // Step 3: Query positions in small batches
  console.log('Step 3: Finding positions in these markets...\n');

  const walletData: Map<string, {
    positions: any[];
    wins: number;
    losses: number;
    totalPnl: number;
  }> = new Map();

  const batchSize = 20; // Smaller batches
  let successfulBatches = 0;

  for (let i = 0; i < resolvedIds.length; i += batchSize) {
    const batch = resolvedIds.slice(i, i + batchSize);

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
          WHERE entry_price > 0.05 AND entry_price < 0.75
        `,
        format: 'JSONEachRow'
      });

      const positions = await posQuery.json() as any[];

      for (const pos of positions) {
        if (!walletData.has(pos.wallet)) {
          walletData.set(pos.wallet, { positions: [], wins: 0, losses: 0, totalPnl: 0 });
        }
        const data = walletData.get(pos.wallet)!;
        data.positions.push(pos);
        if (pos.pnl > 0) {
          data.wins++;
        } else {
          data.losses++;
        }
        data.totalPnl += pos.pnl;
      }

      successfulBatches++;
      process.stdout.write(`\r  Processed ${i + batch.length}/${resolvedIds.length} conditions (${walletData.size} wallets)`);

    } catch (err: any) {
      process.stdout.write(`\r  Batch ${Math.floor(i/batchSize) + 1} failed: ${err.message?.substring(0, 40)}...`);
    }
  }

  console.log(`\n\nSuccessful batches: ${successfulBatches}`);
  console.log(`Total wallets with insider-market positions: ${walletData.size}\n`);

  // Step 4: Find wallets with perfect or near-perfect records
  console.log('Step 4: Finding perfect records...\n');

  const perfectWallets: {
    wallet: string;
    wins: number;
    losses: number;
    positions: any[];
    totalPnl: number;
    avgEntry: number;
    avgReturn: number;
  }[] = [];

  for (const [wallet, data] of walletData) {
    // Must have at least 2 positions with $50+ PnL
    if (data.positions.length < 2) continue;
    if (data.totalPnl <= 50) continue;

    // Calculate metrics
    const avgEntry = data.positions.reduce((sum, p) => sum + p.entry_price, 0) / data.positions.length;
    const winningPos = data.positions.filter(p => p.pnl > 0);
    const avgReturn = winningPos.length > 0
      ? winningPos.reduce((sum, p) => sum + (p.pnl / p.cost_basis), 0) / winningPos.length
      : 0;

    perfectWallets.push({
      wallet,
      wins: data.wins,
      losses: data.losses,
      positions: data.positions,
      totalPnl: data.totalPnl,
      avgEntry,
      avgReturn
    });
  }

  // Sort by win rate, then by wins
  perfectWallets.sort((a, b) => {
    const wrA = a.wins / (a.wins + a.losses);
    const wrB = b.wins / (b.wins + b.losses);
    if (wrB !== wrA) return wrB - wrA;
    return b.wins - a.wins;
  });

  // Filter for 100% win rate
  const trueInsiders = perfectWallets.filter(w => w.losses === 0 && w.wins >= 2);

  console.log(`🎯 TRUE INSIDERS (100% WR, 2+ positions in Fed/Inflation/Earnings): ${trueInsiders.length}\n`);

  if (trueInsiders.length > 0) {
    console.log('Wallet'.padEnd(44) + 'Wins'.padStart(6) + 'Entry'.padStart(8) + 'Return'.padStart(9) + 'PnL'.padStart(12));
    console.log('='.repeat(85));

    for (const w of trueInsiders.slice(0, 30)) {
      console.log(
        w.wallet.padEnd(44) +
        `${w.wins}`.padStart(6) +
        `${(w.avgEntry * 100).toFixed(0)}%`.padStart(8) +
        `${(w.avgReturn * 100).toFixed(0)}%`.padStart(9) +
        `$${w.totalPnl.toFixed(0)}`.padStart(12)
      );
    }

    console.log('\n\n🔥 TOP INSIDER PROFILES:\n');

    for (const w of trueInsiders.slice(0, 15)) {
      console.log(w.wallet);
      console.log(`  Perfect Record: ${w.wins}/${w.wins} (100% WR in Fed/Inflation/Earnings)`);
      console.log(`  Avg Entry:      ${(w.avgEntry * 100).toFixed(1)}%`);
      console.log(`  Avg Return:     ${(w.avgReturn * 100).toFixed(0)}% per trade`);
      console.log(`  Total PnL:      $${w.totalPnl.toFixed(2)}`);
      console.log(`  Profile:        https://polymarket.com/profile/${w.wallet}`);
      console.log('  Trades:');
      for (const p of w.positions.slice(0, 5)) {
        console.log(`    ✓ ${p.question?.substring(0, 55)}...`);
        console.log(`      Entry: ${(p.entry_price * 100).toFixed(0)}% → PnL: $${p.pnl.toFixed(0)}`);
      }
      console.log('');
    }

    console.log('\n=== ALL TRUE INSIDER ADDRESSES ===\n');
    for (const w of trueInsiders) {
      console.log(w.wallet);
    }
  }

  // Also show high win rates (80%+)
  const highWinRate = perfectWallets.filter(w => {
    const wr = w.wins / (w.wins + w.losses);
    return wr >= 0.80 && w.wins >= 3 && w.totalPnl > 100;
  });

  if (highWinRate.length > 0) {
    console.log(`\n\n📊 HIGH WIN RATE (80%+, 3+ wins) in Fed/Inflation/Earnings: ${highWinRate.length}\n`);

    for (const w of highWinRate.slice(0, 20)) {
      const wr = ((w.wins / (w.wins + w.losses)) * 100).toFixed(0);
      console.log(`${w.wallet}`);
      console.log(`  Record: ${w.wins}/${w.wins + w.losses} (${wr}% WR)`);
      console.log(`  Entry: ${(w.avgEntry * 100).toFixed(0)}% | Return: ${(w.avgReturn * 100).toFixed(0)}% | PnL: $${w.totalPnl.toFixed(0)}`);
      console.log(`  Profile: https://polymarket.com/profile/${w.wallet}`);
      console.log(`  Sample: ${w.positions[0]?.question?.substring(0, 60)}...`);
      console.log('');
    }
  }
}

main().catch(console.error);
