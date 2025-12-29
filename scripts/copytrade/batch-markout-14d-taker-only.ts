/**
 * Batch 14-Day Taker-Only Markout Sharpe with T-Statistics
 *
 * Runs against all wallets collected from exports/copytrade folder.
 *
 * Formula (per GPT spec):
 * - Markout: m_i = direction * (p_ref - p_fill) in bps
 * - Weight: w_i = min(sqrt(notional), 1000)
 * - Sharpe: weighted_mean / weighted_std
 * - T-statistic: Sharpe * sqrt(N_eff) where N_eff = (sum(w))^2 / sum(w^2)
 *
 * TAKER ONLY - for copy-trading signal
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
  // Batch query for multiple wallets at once
  const walletsLower = wallets.map(w => w.toLowerCase());

  // Simplified single-pass query with inline variance calculation
  const query = `
    WITH
    -- Get taker fills with 14d price reference
    fills_with_price AS (
      SELECT
        t.trader_wallet as wallet,
        t.event_id,
        t.token_id,
        t.usdc_amount / 1000000.0 as notional,
        if(lower(t.side) = 'buy', 1, -1) as direction,
        t.usdc_amount / t.token_amount as fill_price,
        p.last_price as price_14d,
        least(sqrt(t.usdc_amount / 1000000.0), {w_max:Float64}) as weight
      FROM pm_trader_events_v2 t
      INNER JOIN pm_price_snapshots_15m p ON
        p.token_id = t.token_id
        AND p.bucket >= t.trade_time + INTERVAL 13 DAY + INTERVAL 20 HOUR
        AND p.bucket <= t.trade_time + INTERVAL 14 DAY + INTERVAL 4 HOUR
      WHERE t.trader_wallet IN ({wallets:Array(String)})
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.role = 'taker'
        AND t.trade_time <= now() - INTERVAL 14 DAY
        AND t.trade_time >= now() - INTERVAL 90 DAY
        AND p.last_price > 0 AND p.last_price <= 1
      GROUP BY t.trader_wallet, t.event_id, t.token_id, t.usdc_amount, t.token_amount, t.side, p.last_price
    ),
    -- Compute markout and aggregate stats
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
      HAVING fills >= 5
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
  console.log('14-DAY TAKER-ONLY MARKOUT WITH T-STATISTICS');
  console.log('============================================');
  console.log('');
  console.log('Methodology:');
  console.log('- Markout = direction × (price_14d - fill_price) × 10000 bps');
  console.log('- Weight = min(sqrt(notional), 1000)');
  console.log('- Sharpe = weighted_mean / (weighted_std + 1)');
  console.log('- T-stat = Sharpe × √N_eff');
  console.log('- TAKER ONLY (role = "taker") for copy-trading signal');
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
  console.log(`Total wallets with 14d markout data: ${allResults.length}`);
  console.log('');

  // Show top 50 by t-stat
  console.log('=== TOP 50 BY T-STATISTIC (Statistical Significance) ===');
  console.log('');
  console.log('Wallet                                     | Sharpe |  T-Stat | Mean(bps) | Fills  | Markets | Verdict');
  console.log('-------------------------------------------|--------|---------|-----------|--------|---------|--------');

  for (const r of allResults.slice(0, 50)) {
    const verdict = r.t_stat > 4 ? '✅ STRONG'
                  : r.t_stat > 2 ? '👀 PLAUSIBLE'
                  : r.t_stat > 0 ? '⚠️ WEAK'
                  : '❌ NEGATIVE';
    console.log(
      `${r.wallet} | ${r.sharpe.toFixed(2).padStart(6)} | ${r.t_stat.toFixed(1).padStart(7)} | ${r.mean_bps.toFixed(1).padStart(9)} | ${r.fills.toString().padStart(6)} | ${r.markets.toString().padStart(7)} | ${verdict}`
    );
  }

  // Filter for strong candidates (t > 2)
  const strongCandidates = allResults.filter(r => r.t_stat > 2 && r.sharpe > 0);

  console.log('');
  console.log(`=== STRONG CANDIDATES (T-stat > 2, Sharpe > 0): ${strongCandidates.length} wallets ===`);
  console.log('');

  // Save results to JSON
  const outputPath = path.resolve(__dirname, '../../exports/copytrade/markout-14d-taker-tstat-all.json');
  const output = {
    metadata: {
      generated: new Date().toISOString(),
      methodology: '14-Day Taker-Only Markout Sharpe with T-Statistics',
      formula: {
        markout: 'direction * (price_14d - fill_price) * 10000 bps',
        weight: 'min(sqrt(notional), 1000)',
        sharpe: 'weighted_mean / (weighted_std + 1)',
        t_stat: 'sharpe * sqrt(n_eff)',
        n_eff: '(sum(weight))^2 / sum(weight^2)',
      },
      filters: {
        role: 'taker only',
        lookback: '90 days',
        markout_horizon: '14 days',
        min_fills: 5,
      },
      total_wallets_scanned: wallets.length,
      wallets_with_data: allResults.length,
    },
    strong_candidates: strongCandidates.map(r => ({
      wallet: r.wallet,
      sharpe: parseFloat(r.sharpe.toFixed(3)),
      t_stat: parseFloat(r.t_stat.toFixed(2)),
      mean_bps: parseFloat(r.mean_bps.toFixed(1)),
      std_bps: parseFloat(r.std_bps.toFixed(1)),
      fills: r.fills,
      markets: r.markets,
      notional_usd: Math.round(r.notional_usd),
      n_eff: parseFloat(r.n_eff.toFixed(1)),
    })),
    all_results: allResults.map(r => ({
      wallet: r.wallet,
      sharpe: parseFloat(r.sharpe.toFixed(3)),
      t_stat: parseFloat(r.t_stat.toFixed(2)),
      mean_bps: parseFloat(r.mean_bps.toFixed(1)),
      fills: r.fills,
      markets: r.markets,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Results saved to: ${outputPath}`);

  // Also save CSV for strong candidates
  const csvPath = path.resolve(__dirname, '../../exports/copytrade/markout-14d-taker-strong.csv');
  const csvLines = ['wallet,sharpe,t_stat,mean_bps,std_bps,fills,markets,notional_usd,n_eff'];
  for (const r of strongCandidates) {
    csvLines.push([
      r.wallet,
      r.sharpe.toFixed(3),
      r.t_stat.toFixed(2),
      r.mean_bps.toFixed(1),
      r.std_bps.toFixed(1),
      r.fills,
      r.markets,
      Math.round(r.notional_usd),
      r.n_eff.toFixed(1),
    ].join(','));
  }
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`Strong candidates CSV: ${csvPath}`);

  // Summary stats
  const positive = allResults.filter(r => r.sharpe > 0).length;
  const negative = allResults.filter(r => r.sharpe < 0).length;
  const veryStrong = allResults.filter(r => r.t_stat > 4).length;
  const plausible = allResults.filter(r => r.t_stat > 2 && r.t_stat <= 4).length;

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Total with data: ${allResults.length}`);
  console.log(`Positive Sharpe: ${positive} (${(positive/allResults.length*100).toFixed(1)}%)`);
  console.log(`Negative Sharpe: ${negative} (${(negative/allResults.length*100).toFixed(1)}%)`);
  console.log(`T-stat > 4 (Very Strong): ${veryStrong}`);
  console.log(`T-stat 2-4 (Plausible): ${plausible}`);
  console.log(`Strong Candidates (t>2, sharpe>0): ${strongCandidates.length}`);
}

main().catch(console.error);
