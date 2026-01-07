/**
 * Analyze top 100% WR wallets for insider behavior
 * Calculate entry prices from raw trades
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const TOP_WALLETS = [
  '0x2663daca3cecf3767ca1c3b126002a8578a8ed1f',  // $71k PnL
  '0xee8f65dece093382cf1b7c46bb2fa7ad3c6e7e11',  // $26k PnL
  '0xd1c769317bd15de77658c3a18f2bafe26c42ca9a',  // $17k PnL
  '0xa67209aaa09ba891adb7d291310e49914472f083',  // $17k PnL
  '0xd9430448ac33ddce60d68f6d7e989e30fa4fbca5',  // $17k PnL
  '0x0ae6fb015799fa0e9d23eb8df9ca35b5c83f1d06',  // $13k PnL
  '0x91c702f141502ecf642f5e93e58fce6a78c6a9fe',  // $12k PnL
  '0x74416687453b92a84376dfb57a7ba69d0a84a7db',  // $12k PnL
  '0x81d90fcbd2e76d319a8d5a97ac30854818bd60f1',  // $10k PnL
  '0x828cc793bf4cd7547fec72cee60e92c7bb0ff28f',  // $9k PnL
  '0xf92a950992181e21870b7d96c0cef9ad96fb10c8',  // $9k PnL
  '0xded219aee874299b487edf2738c0c161f17142e0',  // $8k PnL
  '0x9e98e2471cf815bfa1e32dbcf109a47e67b8bad0',  // $8k PnL
  '0x4afc86332d3137893e9b2e29bc4e97bf0f17b13e',  // $8k PnL
  '0xc07fbce3cced80c48e78296538b71cec8ed82c09',  // $8k PnL
];

async function analyzeWallet(wallet: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`WALLET: ${wallet}`);
  console.log('='.repeat(80));

  // Get all trades for this wallet
  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        event_id,
        token_id,
        lower(side) as side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}'
        AND is_deleted = 0
      ORDER BY trade_time
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQuery.json() as any[];
  console.log(`Total trades: ${trades.length}`);

  // Get unique token IDs and their mappings
  const tokenIds = [...new Set(trades.map(t => t.token_id))];
  console.log(`Unique tokens: ${tokenIds.length}`);

  // Get condition mappings
  const mappingQuery = await clickhouse.query({
    query: `
      SELECT token_id_dec, condition_id, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${tokenIds.map(t => `'${t}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const mappings = await mappingQuery.json() as any[];
  const tokenToCondition: Record<string, { condition_id: string; outcome_index: number }> = {};
  for (const m of mappings) {
    tokenToCondition[m.token_id_dec] = { condition_id: m.condition_id, outcome_index: m.outcome_index };
  }
  console.log(`Mapped tokens: ${mappings.length}`);

  // Get resolutions
  const conditionIds = [...new Set(mappings.map(m => m.condition_id))];
  if (conditionIds.length === 0) {
    console.log('No mapped conditions found');
    return;
  }

  const resQuery = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators, payout_denominator
      FROM pm_condition_resolutions FINAL
      WHERE condition_id IN (${conditionIds.map(c => `'${c}'`).join(',')})
        AND is_deleted = 0
        AND payout_denominator != ''
        AND payout_denominator != '0'
    `,
    format: 'JSONEachRow'
  });
  const resolutions = await resQuery.json() as any[];
  const conditionToResolution: Record<string, { numerators: number[]; denominator: number }> = {};
  for (const r of resolutions) {
    conditionToResolution[r.condition_id] = {
      numerators: JSON.parse(r.payout_numerators),
      denominator: parseFloat(r.payout_denominator)
    };
  }
  console.log(`Resolved conditions: ${resolutions.length}`);

  // Build positions
  interface Position {
    condition_id: string;
    buys: number;
    buyUsdc: number;
    buyTokens: number;
    sells: number;
    sellUsdc: number;
    sellTokens: number;
    payout: number;
  }

  const positions: Record<string, Position> = {};

  for (const trade of trades) {
    const mapping = tokenToCondition[trade.token_id];
    if (!mapping) continue;

    const resolution = conditionToResolution[mapping.condition_id];
    if (!resolution) continue;

    const payout = resolution.numerators[mapping.outcome_index] / resolution.denominator;

    if (!positions[mapping.condition_id]) {
      positions[mapping.condition_id] = {
        condition_id: mapping.condition_id,
        buys: 0,
        buyUsdc: 0,
        buyTokens: 0,
        sells: 0,
        sellUsdc: 0,
        sellTokens: 0,
        payout
      };
    }

    const pos = positions[mapping.condition_id];
    if (trade.side === 'buy') {
      pos.buys++;
      pos.buyUsdc += trade.usdc;
      pos.buyTokens += trade.tokens;
    } else {
      pos.sells++;
      pos.sellUsdc += trade.usdc;
      pos.sellTokens += trade.tokens;
    }
  }

  // Calculate results
  interface PositionResult {
    condition_id: string;
    costBasis: number;
    entryPrice: number;
    payout: number;
    payoutValue: number;
    pnl: number;
    isWin: boolean;
  }

  const results: PositionResult[] = [];

  for (const pos of Object.values(positions)) {
    if (pos.buyUsdc < 1) continue; // Skip tiny positions

    const netTokens = pos.buyTokens - pos.sellTokens;
    const costBasis = pos.buyUsdc;
    const entryPrice = costBasis / pos.buyTokens;
    const payoutValue = pos.sellUsdc + (Math.max(0, netTokens) * pos.payout);
    const pnl = payoutValue - costBasis;
    const isWin = pnl > 0;

    results.push({
      condition_id: pos.condition_id,
      costBasis,
      entryPrice,
      payout: pos.payout,
      payoutValue,
      pnl,
      isWin
    });
  }

  // Calculate stats
  const wins = results.filter(r => r.isWin);
  const winRate = wins.length / results.length;
  const totalPnL = results.reduce((sum, r) => sum + r.pnl, 0);

  const winEntries = wins.map(r => r.entryPrice).filter(e => e > 0 && e < 1);
  const avgWinEntry = winEntries.length > 0
    ? winEntries.reduce((a, b) => a + b, 0) / winEntries.length
    : 0;
  const avgPriceSwing = avgWinEntry > 0 ? 1 - avgWinEntry : 0;
  const bestEntry = winEntries.length > 0 ? Math.min(...winEntries) : 1;
  const earlyWins = winEntries.filter(e => e < 0.50).length;

  console.log(`\nPOSITIONS: ${results.length}`);
  console.log(`  Wins:          ${wins.length} (${(winRate * 100).toFixed(1)}%)`);
  console.log(`  Total PnL:     $${totalPnL.toFixed(2)}`);
  console.log(`  Avg Entry (W): ${(avgWinEntry * 100).toFixed(1)}%`);
  console.log(`  Avg Swing:     ${(avgPriceSwing * 100).toFixed(1)}%`);
  console.log(`  Best Entry:    ${(bestEntry * 100).toFixed(1)}%`);
  console.log(`  Early Wins:    ${earlyWins} (entered < 50%)`);

  // Show best early calls
  const sortedByEntry = [...wins].sort((a, b) => a.entryPrice - b.entryPrice);
  console.log(`\nBEST EARLY CALLS (lowest entry price wins):`);
  for (const r of sortedByEntry.slice(0, 10)) {
    console.log(`  Entry: ${(r.entryPrice * 100).toFixed(1)}% → Payout: ${(r.payout * 100).toFixed(0)}% | Bet: $${r.costBasis.toFixed(0)} | PnL: $${r.pnl.toFixed(0)}`);
  }

  return {
    wallet,
    positions: results.length,
    wins: wins.length,
    winRate,
    avgWinEntry,
    avgPriceSwing,
    bestEntry,
    earlyWins,
    totalPnL
  };
}

async function main() {
  console.log('=== INSIDER / SUPERFORECASTER ANALYSIS ===');
  console.log('Analyzing top 100% WR wallets for early entry patterns\n');

  const results = [];

  for (const wallet of TOP_WALLETS) {
    try {
      const result = await analyzeWallet(wallet);
      if (result) results.push(result);
    } catch (err: any) {
      console.log(`Error analyzing ${wallet}: ${err.message}`);
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n🎯 SUMMARY: Analyzed ${results.length} wallets\n`);

  // Sort by avg price swing (highest = best early callers)
  results.sort((a, b) => b.avgPriceSwing - a.avgPriceSwing);

  console.log('Wallet'.padEnd(44) + 'WR%'.padStart(6) + 'Swing'.padStart(8) + 'Entry'.padStart(8) + 'Early'.padStart(7) + 'PnL'.padStart(12));
  console.log('-'.repeat(90));

  for (const r of results) {
    console.log(
      r.wallet.padEnd(44) +
      `${(r.winRate * 100).toFixed(0)}%`.padStart(6) +
      `${(r.avgPriceSwing * 100).toFixed(0)}%`.padStart(8) +
      `${(r.avgWinEntry * 100).toFixed(0)}%`.padStart(8) +
      String(r.earlyWins).padStart(7) +
      `$${r.totalPnL.toFixed(0)}`.padStart(12)
    );
  }

  // Identify true insiders (low entry prices = called it early)
  const insiders = results.filter(r =>
    r.avgWinEntry > 0 && r.avgWinEntry < 0.70 &&  // Entry < 70%
    r.earlyWins >= 2                               // At least 2 early wins
  );

  console.log(`\n🔥 LIKELY INSIDERS/SUPERFORECASTERS (avg entry < 70%, 2+ early wins): ${insiders.length}\n`);

  for (const r of insiders) {
    console.log(`${r.wallet}`);
    console.log(`  Win Rate:      ${(r.winRate * 100).toFixed(1)}%`);
    console.log(`  Avg Entry:     ${(r.avgWinEntry * 100).toFixed(1)}% (bought EARLY)`);
    console.log(`  Price Swing:   ${(r.avgPriceSwing * 100).toFixed(1)}% (captured movement)`);
    console.log(`  Best Entry:    ${(r.bestEntry * 100).toFixed(1)}%`);
    console.log(`  Early Wins:    ${r.earlyWins}`);
    console.log(`  Total PnL:     $${r.totalPnL.toFixed(0)}`);
    console.log(`  Profile:       https://polymarket.com/profile/${r.wallet}`);
    console.log('');
  }
}

main().catch(console.error);
