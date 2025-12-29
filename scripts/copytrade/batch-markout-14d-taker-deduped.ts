/**
 * Batch 14-Day Taker-Only Markout Sharpe with T-Statistics
 *
 * FIXED: Proper deduplication using GROUP BY event_id pattern
 * FIXED: Takes first price snapshot in 14d window (not multiple)
 * FIXED: Filters out low-fill noise (min 20 fills)
 *
 * Formula (per GPT spec):
 * - Markout: m_i = direction * (p_ref - p_fill) in bps
 * - Weight: w_i = min(sqrt(notional), 1000)
 * - Sharpe: weighted_mean / weighted_std
 * - T-statistic: Sharpe * sqrt(N_eff) where N_eff = (sum(w))^2 / sum(w^2)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const W_MAX = 1000;
const MIN_FILLS = 20; // Higher minimum to filter noise

interface MarkoutResult {
  wallet: string;
  sharpe: number;
  t_stat: number;
  mean_bps: number;
  std_bps: number;
  fills: number;
  markets: number;
  notional_usd: number;
  n_eff: number;
}

async function computeBatchMarkout(wallets: string[]): Promise<MarkoutResult[]> {
  const walletsLower = wallets.map(w => w.toLowerCase());

  // FIXED: Proper deduplication pattern from CLAUDE.md
  const query = `
    WITH
    -- Step 1: Dedupe fills by event_id (REQUIRED per CLAUDE.md)
    deduped_fills AS (
      SELECT
        event_id,
        any(trader_wallet) as trader_wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(trade_time) as trade_time,
        any(usdc_amount) / 1000000.0 as notional,
        any(usdc_amount) / any(token_amount) as fill_price
      FROM pm_trader_events_v2
      WHERE trader_wallet IN ({wallets:Array(String)})
        AND is_deleted = 0
        AND token_amount > 0
        AND role = 'taker'
        AND trade_time <= now() - INTERVAL 14 DAY
        AND trade_time >= now() - INTERVAL 90 DAY
      GROUP BY event_id
    ),
    -- Step 2: Get FIRST price snapshot in 14d window (avoid duplicates)
    fills_with_price AS (
      SELECT
        f.trader_wallet as wallet,
        f.event_id,
        f.token_id,
        f.notional,
        if(lower(f.side) = 'buy', 1, -1) as direction,
        f.fill_price,
        -- Take first (min) price snapshot in window
        min(p.last_price) as price_14d,
        least(sqrt(f.notional), {w_max:Float64}) as weight
      FROM deduped_fills f
      INNER JOIN pm_price_snapshots_15m p ON
        p.token_id = f.token_id
        AND p.bucket >= f.trade_time + INTERVAL 13 DAY + INTERVAL 20 HOUR
        AND p.bucket <= f.trade_time + INTERVAL 14 DAY + INTERVAL 4 HOUR
      WHERE p.last_price > 0 AND p.last_price <= 1
      GROUP BY f.trader_wallet, f.event_id, f.token_id, f.notional, f.side, f.fill_price
    ),
    -- Step 3: Compute markout and aggregate stats
    wallet_stats AS (
      SELECT
        wallet,
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as total_notional,
        sum(weight) as total_weight,
        sum(weight * weight) as total_weight_sq,
        sum(weight * direction * (price_14d - fill_price) * 10000) / sum(weight) as wmean,
        -- Variance: E[X^2] - E[X]^2 form
        sum(weight * pow(direction * (price_14d - fill_price) * 10000, 2)) / sum(weight)
          - pow(sum(weight * direction * (price_14d - fill_price) * 10000) / sum(weight), 2) as wvar
      FROM fills_with_price
      GROUP BY wallet
      HAVING fills >= {min_fills:UInt32}
    )
    SELECT
      wallet as trader_wallet,
      fills,
      markets,
      total_notional,
      wmean as weighted_mean,
      sqrt(greatest(wvar, 0)) as weighted_std,
      total_weight,
      total_weight_sq,
      pow(total_weight, 2) / total_weight_sq as n_eff
    FROM wallet_stats
    ORDER BY fills DESC
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: {
        wallets: walletsLower,
        w_max: W_MAX,
        min_fills: MIN_FILLS,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    return rows.map(row => {
      const mean = parseFloat(row.weighted_mean) || 0;
      const std = parseFloat(row.weighted_std) || 1;
      const nEff = parseFloat(row.n_eff) || 1;
      const sharpe = mean / (std + 1);
      const tStat = sharpe * Math.sqrt(nEff);

      return {
        wallet: row.trader_wallet,
        sharpe,
        t_stat: tStat,
        mean_bps: mean,
        std_bps: std,
        fills: parseInt(row.fills),
        markets: parseInt(row.markets),
        notional_usd: parseFloat(row.total_notional) || 0,
        n_eff: nEff,
      };
    });
  } catch (err: any) {
    console.error(`Batch error: ${err.message}`);
    return [];
  }
}

async function main() {
  // Read wallets from temp file
  const walletsFile = '/tmp/all_copytrade_wallets.txt';
  const wallets = fs.readFileSync(walletsFile, 'utf-8')
    .split('\n')
    .filter(w => w.startsWith('0x'));

  console.log(`Found ${wallets.length} unique wallets to evaluate`);
  console.log('');
  console.log('14-DAY TAKER-ONLY MARKOUT WITH T-STATISTICS (DEDUPED)');
  console.log('=====================================================');
  console.log('');
  console.log('FIXES APPLIED:');
  console.log('1. Proper deduplication: GROUP BY event_id with any() pattern');
  console.log('2. Single price per fill: min(last_price) in 14d window');
  console.log(`3. Higher minimum fills: ${MIN_FILLS} (filters noise)`);
  console.log('');

  const BATCH_SIZE = 100;
  const allResults: MarkoutResult[] = [];

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    process.stdout.write(`Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(wallets.length/BATCH_SIZE)}...`);

    const results = await computeBatchMarkout(batch);
    allResults.push(...results);

    console.log(` ${results.length} wallets with data`);
  }

  // Sort by t-statistic descending
  allResults.sort((a, b) => b.t_stat - a.t_stat);

  console.log('');
  console.log(`Total wallets with sufficient data: ${allResults.length}`);
  console.log('');

  // Known wallets from original evaluation
  const knownWallets = new Set([
    '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2', // @gmanas
    '0x7744bfd749a70020d16a1fcbac1d064761c9999e', // @chungguskhan
    '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', // @primm
    '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee', // @kch123
    '0x71a70f24538d885d1b45f9cea158a2cdf2e56fcf', // @easyclap
    '0xe9c6312464b52aa3eff13d822b003282075995c9', // @kingofcoinflips
    '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', // @RN1
    '0x0f37cb80dee49d55b5f6d9e595d52591d6371410', // @Hans323
    '0xfeb581080aee6dc26c264a647b30a9cd44d5a393', // @completion
    '0x3c593aeb73ebdadbc9ce76d4264a6a2af4011766', // @eightpenguins
    '0x000d257d2dc7616feaef4ae0f14600fdf50a758e', // @scottilicious
    '0x00090e8b4fa8f88dc9c1740e460dd0f670021d43', // Super forecaster
    '0x43372356634781eea88d61bbdd7824cdce958882', // @Anjun
    '0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82', // @justdance
    '0x4638d71d7b2d36eb590b5e1824955712dc8ad587', // @jeb2016
    '0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd', // @0xheavy888
    '0x138d421a019640f71ea7200e0d062afdbd8d4bc0', // phase8 highlighted
    '0x41583f2efc720b8e2682750fffb67f2806fece9f', // @Toncar16
    '0x751a2b86cab503496efd325c8344e10159349ea1', // @Sharky6999
  ].map(w => w.toLowerCase()));

  // Show NEW strong wallets (not in our original list)
  const newStrong = allResults.filter(r =>
    r.t_stat > 4 &&
    r.sharpe > 0 &&
    !knownWallets.has(r.wallet.toLowerCase())
  );

  console.log(`=== NEW STRONG WALLETS (Not in original evaluation, t>4, sharpe>0): ${newStrong.length} ===`);
  console.log('');
  console.log('Wallet                                     | Sharpe |  T-Stat | Mean(bps) | Fills  | Markets | Notional $');
  console.log('-------------------------------------------|--------|---------|-----------|--------|---------|----------');

  for (const r of newStrong.slice(0, 30)) {
    console.log(
      `${r.wallet} | ${r.sharpe.toFixed(2).padStart(6)} | ${r.t_stat.toFixed(1).padStart(7)} | ${r.mean_bps.toFixed(1).padStart(9)} | ${r.fills.toString().padStart(6)} | ${r.markets.toString().padStart(7)} | ${Math.round(r.notional_usd).toLocaleString().padStart(10)}`
    );
  }

  // Show original evaluation wallets
  console.log('');
  console.log('=== ORIGINAL EVALUATION WALLETS (DEDUPED RESULTS) ===');
  console.log('');
  console.log('Wallet                                     | Sharpe |  T-Stat | Fills  | Status');
  console.log('-------------------------------------------|--------|---------|--------|-------');

  const walletNames: Record<string, string> = {
    '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2': '@gmanas',
    '0x7744bfd749a70020d16a1fcbac1d064761c9999e': '@chungguskhan',
    '0x000d257d2dc7616feaef4ae0f14600fdf50a758e': '@scottilicious',
    '0x00090e8b4fa8f88dc9c1740e460dd0f670021d43': 'Super forecaster',
    '0x43372356634781eea88d61bbdd7824cdce958882': '@Anjun',
    '0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82': '@justdance',
    '0x0f37cb80dee49d55b5f6d9e595d52591d6371410': '@Hans323',
    '0xfeb581080aee6dc26c264a647b30a9cd44d5a393': '@completion',
    '0x3c593aeb73ebdadbc9ce76d4264a6a2af4011766': '@eightpenguins',
    '0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd': '@0xheavy888',
    '0x138d421a019640f71ea7200e0d062afdbd8d4bc0': '@phase8_wallet',
    '0x41583f2efc720b8e2682750fffb67f2806fece9f': '@Toncar16',
    '0x751a2b86cab503496efd325c8344e10159349ea1': '@Sharky6999',
  };

  for (const [wallet, name] of Object.entries(walletNames)) {
    const r = allResults.find(x => x.wallet.toLowerCase() === wallet.toLowerCase());
    if (r) {
      const verdict = r.t_stat > 4 ? '✅ STRONG' : r.t_stat > 2 ? '👀 PLAUSIBLE' : r.t_stat > 0 ? '⚠️ WEAK' : '❌ NEGATIVE';
      console.log(`${r.wallet} | ${r.sharpe.toFixed(2).padStart(6)} | ${r.t_stat.toFixed(1).padStart(7)} | ${r.fills.toString().padStart(6)} | ${verdict} (${name})`);
    } else {
      console.log(`${wallet} | NO DATA (< ${MIN_FILLS} fills) - ${name}`);
    }
  }

  // Save results
  const outputPath = path.resolve(__dirname, '../../exports/copytrade/markout-14d-deduped-all.json');
  const output = {
    metadata: {
      generated: new Date().toISOString(),
      methodology: '14-Day Taker-Only Markout Sharpe with T-Statistics (DEDUPED)',
      fixes: [
        'Proper deduplication: GROUP BY event_id with any() pattern',
        'Single price per fill: min(last_price) in 14d window',
        `Higher minimum fills: ${MIN_FILLS}`
      ],
      formula: {
        markout: 'direction * (price_14d - fill_price) * 10000 bps',
        weight: 'min(sqrt(notional), 1000)',
        sharpe: 'weighted_mean / (weighted_std + 1)',
        t_stat: 'sharpe * sqrt(n_eff)',
      },
      total_wallets_scanned: wallets.length,
      wallets_with_data: allResults.length,
    },
    new_strong_wallets: newStrong.map(r => ({
      wallet: r.wallet,
      sharpe: parseFloat(r.sharpe.toFixed(3)),
      t_stat: parseFloat(r.t_stat.toFixed(2)),
      mean_bps: parseFloat(r.mean_bps.toFixed(1)),
      fills: r.fills,
      markets: r.markets,
      notional_usd: Math.round(r.notional_usd),
    })),
    all_results: allResults.map(r => ({
      wallet: r.wallet,
      sharpe: parseFloat(r.sharpe.toFixed(3)),
      t_stat: parseFloat(r.t_stat.toFixed(2)),
      mean_bps: parseFloat(r.mean_bps.toFixed(1)),
      fills: r.fills,
      markets: r.markets,
      notional_usd: Math.round(r.notional_usd),
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log('');
  console.log(`Results saved to: ${outputPath}`);

  // Summary
  const positive = allResults.filter(r => r.sharpe > 0).length;
  const negative = allResults.filter(r => r.sharpe < 0).length;
  const veryStrong = allResults.filter(r => r.t_stat > 4 && r.sharpe > 0).length;

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Total with data (${MIN_FILLS}+ fills): ${allResults.length}`);
  console.log(`Positive Sharpe: ${positive} (${(positive/allResults.length*100).toFixed(1)}%)`);
  console.log(`Negative Sharpe: ${negative} (${(negative/allResults.length*100).toFixed(1)}%)`);
  console.log(`Very Strong (t>4, sharpe>0): ${veryStrong}`);
  console.log(`NEW Strong (not in original eval): ${newStrong.length}`);
}

main().catch(console.error);
