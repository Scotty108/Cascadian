/**
 * Compute 24h Markout Sharpe for copy-trade evaluation
 *
 * Markout = price movement in your favor after trade
 * Sharpe = mean(markout) / std(markout) - measures edge + consistency
 *
 * Per ChatGPT analysis: This is the single best metric for copy-trading
 * because it directly measures "does market move in your favor after you trade"
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

// Our evaluated wallets
const WALLETS = [
  { name: '@gmanas', wallet: '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2' },
  { name: '@chungguskhan', wallet: '0x7744bfd749a70020d16a1fcbac1d064761c9999e' },
  { name: '@primm', wallet: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029' },
  { name: '@kch123', wallet: '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee' },
  { name: '@easyclap', wallet: '0x71a70f24538d885d1b45f9cea158a2cdf2e56fcf' },
  { name: '@kingofcoinflips', wallet: '0xe9c6312464b52aa3eff13d822b003282075995c9' },
  { name: '@Sharky6999', wallet: '0x751a2b86cab503496efd325c8344e10159349ea1' },
  { name: '@LlamaEnjoyer', wallet: '0x9b979a065641e8cfde3022a30ed2d9415cf55e12' },
  { name: '@scottilicious', wallet: '0x000d257d2dc7616feaef4ae0f14600fdf50a758e' },
  { name: '@ZerOptimist', wallet: '0x2c57db9e442ef5ffb2651f03afd551171738c94d' },
  { name: '@Anjun', wallet: '0x43372356634781eea88d61bbdd7824cdce958882' },
  { name: '@justdance', wallet: '0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82' },
  { name: '@eightpenguins', wallet: '0x3c593aeb73ebdadbc9ce76d4264a6a2af4011766' },
  { name: '@Hans323', wallet: '0x0f37cb80dee49d55b5f6d9e595d52591d6371410' },
  { name: '@completion', wallet: '0xfeb581080aee6dc26c264a647b30a9cd44d5a393' },
  { name: '@darkrider11', wallet: '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a' },
  { name: '@piastri', wallet: '0x2f09642639aedd6ced432519c1a86e7d52034632' },
];

interface MarkoutResult {
  name: string;
  wallet: string;
  trades_with_markout: number;
  avg_markout_bps: number;
  std_markout_bps: number;
  sharpe: number;
  win_rate_markout: number;
  median_markout_bps: number;
}

async function computeMarkoutForWallet(name: string, wallet: string): Promise<MarkoutResult | null> {
  // Query: For each trade, find the price 24h later and compute markout
  // Markout = (price_24h - fill_price) * direction
  // Direction: buy = +1 (want price to go up), sell = -1 (want price to go down)

  const query = `
    WITH trades AS (
      SELECT
        event_id,
        token_id,
        side,
        usdc_amount / 1000000.0 as usdc,
        token_amount / 1000000.0 as tokens,
        trade_time,
        -- Fill price = USDC / tokens
        usdc_amount / token_amount as fill_price
      FROM pm_trader_events_v2
      WHERE trader_wallet = {wallet:String}
        AND is_deleted = 0
        AND trade_time >= now() - INTERVAL 60 DAY
        AND trade_time <= now() - INTERVAL 1 DAY  -- Need 24h after trade
        AND token_amount > 0
      GROUP BY event_id, token_id, side, usdc_amount, token_amount, trade_time
    ),
    trades_with_future_price AS (
      SELECT
        t.event_id,
        t.token_id,
        t.side,
        t.fill_price,
        t.usdc,
        t.trade_time,
        -- Find price closest to 24h after trade
        p.last_price as price_24h,
        -- Direction: buy = +1, sell = -1
        if(lower(t.side) = 'buy', 1, -1) as direction
      FROM trades t
      INNER JOIN pm_price_snapshots_15m p ON
        p.token_id = t.token_id
        AND p.bucket >= t.trade_time + INTERVAL 23 HOUR
        AND p.bucket <= t.trade_time + INTERVAL 25 HOUR
    ),
    markouts AS (
      SELECT
        event_id,
        fill_price,
        price_24h,
        direction,
        usdc,
        -- Markout in basis points (normalized to 0-1 price range)
        (price_24h - fill_price) * direction * 10000 as markout_bps
      FROM trades_with_future_price
      WHERE price_24h > 0
    )
    SELECT
      count(*) as n_trades,
      avg(markout_bps) as avg_markout,
      stddevPop(markout_bps) as std_markout,
      median(markout_bps) as median_markout,
      countIf(markout_bps > 0) / count(*) as win_rate
    FROM markouts
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: { wallet: wallet.toLowerCase() },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    if (rows.length === 0 || rows[0].n_trades === 0) {
      console.log(`  ${name}: No markout data`);
      return null;
    }

    const row = rows[0];
    const avgMarkout = parseFloat(row.avg_markout) || 0;
    const stdMarkout = parseFloat(row.std_markout) || 1;
    const sharpe = stdMarkout > 0 ? avgMarkout / stdMarkout : 0;

    return {
      name,
      wallet,
      trades_with_markout: parseInt(row.n_trades),
      avg_markout_bps: Math.round(avgMarkout * 10) / 10,
      std_markout_bps: Math.round(stdMarkout * 10) / 10,
      sharpe: Math.round(sharpe * 100) / 100,
      win_rate_markout: Math.round(parseFloat(row.win_rate) * 1000) / 10,
      median_markout_bps: Math.round(parseFloat(row.median_markout) * 10) / 10,
    };
  } catch (err: any) {
    console.error(`  ${name}: Error - ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('24h MARKOUT SHARPE ANALYSIS');
  console.log('===========================');
  console.log('');
  console.log('Markout = price movement in your favor 24h after trade');
  console.log('Sharpe = avg_markout / std_markout (higher = better edge + consistency)');
  console.log('');

  const results: MarkoutResult[] = [];

  for (const { name, wallet } of WALLETS) {
    process.stdout.write(`Processing ${name}... `);
    const result = await computeMarkoutForWallet(name, wallet);
    if (result) {
      results.push(result);
      console.log(`Sharpe: ${result.sharpe}, Trades: ${result.trades_with_markout}`);
    }
  }

  // Sort by Sharpe descending
  results.sort((a, b) => b.sharpe - a.sharpe);

  console.log('');
  console.log('RESULTS (Sorted by 24h Markout Sharpe)');
  console.log('======================================');
  console.log('');
  console.log('Wallet          | Sharpe | AvgMO(bps) | StdMO | WinRate | Trades | Verdict');
  console.log('----------------|--------|------------|-------|---------|--------|--------');

  for (const r of results) {
    const verdict = r.sharpe > 0.3 ? '✅ STRONG'
                  : r.sharpe > 0.15 ? '👀 OKAY'
                  : r.sharpe > 0 ? '⚠️ WEAK'
                  : '❌ NEGATIVE';

    console.log(
      `${r.name.padEnd(15)} | ${r.sharpe.toFixed(2).padStart(6)} | ${r.avg_markout_bps.toFixed(1).padStart(10)} | ${r.std_markout_bps.toFixed(0).padStart(5)} | ${r.win_rate_markout.toFixed(1).padStart(6)}% | ${r.trades_with_markout.toString().padStart(6)} | ${verdict}`
    );
  }

  console.log('');
  console.log('INTERPRETATION:');
  console.log('- Sharpe > 0.3: Strong edge, market consistently moves in their favor');
  console.log('- Sharpe 0.15-0.3: Moderate edge, copyable with caveats');
  console.log('- Sharpe < 0.15: Weak/no edge, profits may be from luck or size');
  console.log('- Negative Sharpe: Market moves AGAINST them after trades');
}

main().catch(console.error);
