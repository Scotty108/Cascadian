/**
 * 14-Day Markout Sharpe by Wallet and Category
 *
 * Per ChatGPT spec:
 * - Markout: m_i = direction * (p_ref - p_fill)
 * - p_ref = price at t+14d OR settlement if resolved earlier
 * - Weight: w_i = min(sqrt(notional), w_max)
 * - Weighted Sharpe = weighted_mean / weighted_std
 *
 * Output:
 * 1. Per-wallet overall 14d markout Sharpe
 * 2. Per-wallet per-category 14d markout Sharpe
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

// Wallets to evaluate
const WALLETS = [
  { name: '@gmanas', wallet: '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2' },
  { name: '@chungguskhan', wallet: '0x7744bfd749a70020d16a1fcbac1d064761c9999e' },
  { name: '@primm', wallet: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029' },
  { name: '@kch123', wallet: '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee' },
  { name: '@easyclap', wallet: '0x71a70f24538d885d1b45f9cea158a2cdf2e56fcf' },
  { name: '@kingofcoinflips', wallet: '0xe9c6312464b52aa3eff13d822b003282075995c9' },
  { name: '@RN1', wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea' },
  { name: '@Hans323', wallet: '0x0f37cb80dee49d55b5f6d9e595d52591d6371410' },
  { name: '@completion', wallet: '0xfeb581080aee6dc26c264a647b30a9cd44d5a393' },
  { name: '@eightpenguins', wallet: '0x3c593aeb73ebdadbc9ce76d4264a6a2af4011766' },
  { name: '@scottilicious', wallet: '0x000d257d2dc7616feaef4ae0f14600fdf50a758e' },
  { name: 'Super forecaster', wallet: '0x00090e8b4fa8f88dc9c1740e460dd0f670021d43' },
  { name: '@Anjun', wallet: '0x43372356634781eea88d61bbdd7824cdce958882' },
  { name: '@justdance', wallet: '0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82' },
  { name: '@jeb2016', wallet: '0x4638d71d7b2d36eb590b5e1824955712dc8ad587' },
  { name: '@0xheavy888', wallet: '0xec981ed70ae69c5cbcac08c1ba063e734f6bafcd' },
];

const W_MAX = 1000; // Max weight cap (sqrt of notional)

interface MarkoutResult {
  wallet: string;
  name: string;
  category: string;
  sharpe: number;
  mean_bps: number;
  std_bps: number;
  fills: number;
  markets: number;
  notional_usd: number;
}

async function compute14DayMarkout(walletAddress: string): Promise<MarkoutResult[]> {
  // Query computes 14-day markout with category breakdown
  // Uses price 14 days later from pm_price_snapshots_15m
  // Two-pass approach to avoid nested aggregates
  const query = `
    WITH
    -- Get taker fills with category
    fills AS (
      SELECT
        t.event_id,
        t.token_id,
        t.side,
        t.trade_time,
        t.usdc_amount / 1000000.0 as notional,
        t.usdc_amount / t.token_amount as fill_price,
        coalesce(c.category, 'Unknown') as category
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v5 c
        ON toString(t.token_id) = c.token_id_dec
      WHERE t.trader_wallet = {wallet:String}
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.role = 'taker'  -- TAKER ONLY for copy-trading signal
        AND t.trade_time <= now() - INTERVAL 14 DAY
        AND t.trade_time >= now() - INTERVAL 90 DAY
      GROUP BY t.event_id, t.token_id, t.side, t.trade_time,
               t.usdc_amount, t.token_amount, c.category
    ),
    -- Get reference price 14 days after trade
    fills_with_ref AS (
      SELECT
        f.category,
        f.token_id,
        f.notional,
        if(lower(f.side) = 'buy', 1, -1) as direction,
        p.last_price as price_14d,
        f.fill_price,
        least(sqrt(f.notional), {w_max:Float64}) as weight
      FROM fills f
      INNER JOIN pm_price_snapshots_15m p ON
        p.token_id = f.token_id
        AND p.bucket >= f.trade_time + INTERVAL 13 DAY + INTERVAL 20 HOUR
        AND p.bucket <= f.trade_time + INTERVAL 14 DAY + INTERVAL 4 HOUR
    ),
    -- Compute markout per fill
    markouts AS (
      SELECT
        category,
        token_id,
        direction * (price_14d - fill_price) * 10000 as markout_bps,
        weight,
        notional
      FROM fills_with_ref
      WHERE price_14d > 0 AND price_14d <= 1
    ),
    -- First pass: compute weighted mean per category
    category_means AS (
      SELECT
        category,
        sum(weight * markout_bps) / sum(weight) as wmean,
        sum(weight) as total_weight,
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as total_notional
      FROM markouts
      GROUP BY category
    ),
    -- Second pass: compute weighted std
    category_variance AS (
      SELECT
        m.category,
        cm.wmean,
        cm.total_weight,
        cm.fills,
        cm.markets,
        cm.total_notional,
        sum(m.weight * pow(m.markout_bps - cm.wmean, 2)) / cm.total_weight as wvar
      FROM markouts m
      JOIN category_means cm ON m.category = cm.category
      GROUP BY m.category, cm.wmean, cm.total_weight, cm.fills, cm.markets, cm.total_notional
    )
    SELECT
      category,
      fills,
      markets,
      total_notional,
      wmean as weighted_mean,
      sqrt(wvar) as weighted_std
    FROM category_variance
    WHERE fills >= 10
    ORDER BY wmean / (sqrt(wvar) + 1) DESC
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: {
        wallet: walletAddress.toLowerCase(),
        w_max: W_MAX,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    return rows.map(row => ({
      wallet: walletAddress,
      name: '',
      category: row.category,
      sharpe: parseFloat(row.weighted_mean) / (parseFloat(row.weighted_std) + 1),
      mean_bps: parseFloat(row.weighted_mean) || 0,
      std_bps: parseFloat(row.weighted_std) || 0,
      fills: parseInt(row.fills),
      markets: parseInt(row.markets),
      notional_usd: parseFloat(row.total_notional) || 0,
    }));
  } catch (err: any) {
    console.error(`Error for ${walletAddress}: ${err.message}`);
    return [];
  }
}

async function computeOverall14DayMarkout(walletAddress: string): Promise<MarkoutResult | null> {
  // Same query but without category grouping - two-pass for variance
  const query = `
    WITH
    fills AS (
      SELECT
        t.event_id,
        t.token_id,
        t.side,
        t.trade_time,
        t.usdc_amount / 1000000.0 as notional,
        t.usdc_amount / t.token_amount as fill_price
      FROM pm_trader_events_v2 t
      WHERE t.trader_wallet = {wallet:String}
        AND t.is_deleted = 0
        AND t.token_amount > 0
        AND t.role = 'taker'  -- TAKER ONLY for copy-trading signal
        AND t.trade_time <= now() - INTERVAL 14 DAY
        AND t.trade_time >= now() - INTERVAL 90 DAY
      GROUP BY t.event_id, t.token_id, t.side, t.trade_time,
               t.usdc_amount, t.token_amount
    ),
    fills_with_ref AS (
      SELECT
        f.token_id,
        f.notional,
        if(lower(f.side) = 'buy', 1, -1) as direction,
        p.last_price as price_14d,
        f.fill_price,
        least(sqrt(f.notional), {w_max:Float64}) as weight
      FROM fills f
      INNER JOIN pm_price_snapshots_15m p ON
        p.token_id = f.token_id
        AND p.bucket >= f.trade_time + INTERVAL 13 DAY + INTERVAL 20 HOUR
        AND p.bucket <= f.trade_time + INTERVAL 14 DAY + INTERVAL 4 HOUR
    ),
    markouts AS (
      SELECT
        token_id,
        direction * (price_14d - fill_price) * 10000 as markout_bps,
        weight,
        notional
      FROM fills_with_ref
      WHERE price_14d > 0 AND price_14d <= 1
    ),
    overall_mean AS (
      SELECT
        sum(weight * markout_bps) / sum(weight) as wmean,
        sum(weight) as total_weight,
        count() as fills,
        countDistinct(token_id) as markets,
        sum(notional) as total_notional
      FROM markouts
    ),
    overall_variance AS (
      SELECT
        om.wmean,
        om.total_weight,
        om.fills,
        om.markets,
        om.total_notional,
        sum(m.weight * pow(m.markout_bps - om.wmean, 2)) / om.total_weight as wvar
      FROM markouts m
      CROSS JOIN overall_mean om
      GROUP BY om.wmean, om.total_weight, om.fills, om.markets, om.total_notional
    )
    SELECT
      'OVERALL' as category,
      fills,
      markets,
      total_notional,
      wmean as weighted_mean,
      sqrt(wvar) as weighted_std
    FROM overall_variance
    WHERE fills >= 10
  `;

  try {
    const result = await clickhouse.query({
      query,
      query_params: {
        wallet: walletAddress.toLowerCase(),
        w_max: W_MAX,
      },
      format: 'JSONEachRow',
    });

    const rows = await result.json() as any[];
    if (rows.length === 0) return null;

    const row = rows[0];
    const mean = parseFloat(row.weighted_mean) || 0;
    const std = parseFloat(row.weighted_std) || 1;

    return {
      wallet: walletAddress,
      name: '',
      category: 'OVERALL',
      sharpe: mean / (std + 1),
      mean_bps: mean,
      std_bps: std,
      fills: parseInt(row.fills),
      markets: parseInt(row.markets),
      notional_usd: parseFloat(row.total_notional) || 0,
    };
  } catch (err: any) {
    console.error(`Error for ${walletAddress}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('14-DAY MARKOUT SHARPE ANALYSIS');
  console.log('==============================');
  console.log('');
  console.log('Formula: Sharpe = weighted_mean(markout) / weighted_std(markout)');
  console.log('Markout = direction * (price_14d - fill_price)');
  console.log('Weight = min(sqrt(notional), 1000)');
  console.log('');

  const overallResults: (MarkoutResult & { name: string })[] = [];
  const categoryResults: (MarkoutResult & { name: string })[] = [];

  for (const { name, wallet } of WALLETS) {
    process.stdout.write(`Processing ${name}...`);

    // Get overall 14d markout
    const overall = await computeOverall14DayMarkout(wallet);
    if (overall) {
      overall.name = name;
      overallResults.push(overall as any);
      process.stdout.write(` Overall: ${overall.sharpe.toFixed(2)}`);
    }

    // Get per-category 14d markout
    const byCategory = await compute14DayMarkout(wallet);
    for (const cat of byCategory) {
      cat.name = name;
      categoryResults.push(cat as any);
    }

    console.log(` (${byCategory.length} categories)`);
  }

  // Sort and display overall results
  overallResults.sort((a, b) => b.sharpe - a.sharpe);

  console.log('');
  console.log('=== OVERALL 14-DAY MARKOUT SHARPE (All Categories) ===');
  console.log('');
  console.log('Wallet          | Sharpe | Mean(bps) | Std(bps) | Fills | Markets | Verdict');
  console.log('----------------|--------|-----------|----------|-------|---------|--------');

  for (const r of overallResults) {
    const verdict = r.sharpe > 0.5 ? '✅ STRONG'
                  : r.sharpe > 0.2 ? '👀 OKAY'
                  : r.sharpe > 0 ? '⚠️ WEAK'
                  : '❌ NEGATIVE';
    console.log(
      `${r.name.padEnd(15)} | ${r.sharpe.toFixed(2).padStart(6)} | ${r.mean_bps.toFixed(1).padStart(9)} | ${r.std_bps.toFixed(0).padStart(8)} | ${r.fills.toString().padStart(5)} | ${r.markets.toString().padStart(7)} | ${verdict}`
    );
  }

  // Sort and display by category
  categoryResults.sort((a, b) => b.sharpe - a.sharpe);

  console.log('');
  console.log('=== PER-CATEGORY 14-DAY MARKOUT SHARPE ===');
  console.log('');
  console.log('Wallet          | Category  | Sharpe | Mean(bps) | Fills | Markets | Verdict');
  console.log('----------------|-----------|--------|-----------|-------|---------|--------');

  for (const r of categoryResults.slice(0, 40)) {
    const verdict = r.sharpe > 0.5 ? '✅ STRONG'
                  : r.sharpe > 0.2 ? '👀 OKAY'
                  : r.sharpe > 0 ? '⚠️ WEAK'
                  : '❌ NEGATIVE';
    console.log(
      `${r.name.padEnd(15)} | ${r.category.padEnd(9)} | ${r.sharpe.toFixed(2).padStart(6)} | ${r.mean_bps.toFixed(1).padStart(9)} | ${r.fills.toString().padStart(5)} | ${r.markets.toString().padStart(7)} | ${verdict}`
    );
  }

  // Show best category per wallet
  console.log('');
  console.log('=== BEST CATEGORY PER WALLET ===');
  console.log('');

  const walletBest = new Map<string, MarkoutResult>();
  for (const r of categoryResults) {
    const existing = walletBest.get(r.name);
    if (!existing || r.sharpe > existing.sharpe) {
      walletBest.set(r.name, r);
    }
  }

  const bestList = Array.from(walletBest.values()).sort((a, b) => b.sharpe - a.sharpe);

  console.log('Wallet          | Best Category | Sharpe | Recommendation');
  console.log('----------------|---------------|--------|---------------');

  for (const r of bestList) {
    const rec = r.sharpe > 0.5 ? 'COPY in ' + r.category
              : r.sharpe > 0.2 ? 'Consider in ' + r.category
              : 'Skip';
    console.log(
      `${r.name.padEnd(15)} | ${r.category.padEnd(13)} | ${r.sharpe.toFixed(2).padStart(6)} | ${rec}`
    );
  }

  console.log('');
  console.log('INTERPRETATION:');
  console.log('- 14-day markout captures medium-term price prediction skill');
  console.log('- Sharpe > 0.5: Strong, consistent edge in that category');
  console.log('- Sharpe 0.2-0.5: Moderate edge, copy with position limits');
  console.log('- Sharpe < 0.2: Weak/no edge, profits may be luck');
  console.log('- Copy only in categories where wallet shows edge');
}

main().catch(console.error);
