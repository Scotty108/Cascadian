/**
 * Step 5: Create forecaster leaderboard view
 *
 * Joins CLV metrics with external activity tiers and applies quality gates.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function main() {
  console.log('=== Creating Forecaster Leaderboard ===\n');

  // Step 1: Create the view
  console.log('1. Creating leaderboard view...');
  await ch.command({
    query: `
      CREATE OR REPLACE VIEW pm_wallet_forecaster_candidates_60d AS
      SELECT
        c.wallet,
        c.n_trades_60d,
        c.n_markets_60d,
        c.notional_60d,
        c.last_trade,
        c.active_days_60d,
        c.n_trades_with_p24,
        c.p24_coverage,
        c.clv_24h_weighted,
        c.clv_24h_hit_rate,
        c.median_entry_price,
        c.median_liq_24h_volume,
        e.external_events_60d,
        e.external_activity_ratio,
        e.confidence_tier,

        -- Ranking scores
        c.clv_24h_weighted as primary_score

      FROM pm_wallet_clv_60d c
      LEFT JOIN pm_wallet_external_activity_60d e ON c.wallet = e.wallet

      -- Quality gates
      WHERE c.n_trades_60d >= 20
        AND c.n_trades_with_p24 >= 15
        AND c.p24_coverage >= 0.50
        AND c.last_trade >= now() - INTERVAL 30 DAY

      ORDER BY primary_score DESC
    `,
  });
  console.log('   Done.\n');

  // Step 2: Count candidates
  console.log('2. Candidate pool:');
  const statsQ = await ch.query({
    query: `
      SELECT
        count() as total,
        countIf(confidence_tier = 'A') as tier_a,
        countIf(confidence_tier = 'B') as tier_b,
        countIf(confidence_tier = 'C') as tier_c,
        countIf(clv_24h_weighted > 0) as positive_clv,
        countIf(clv_24h_weighted > 0.05) as strong_clv,
        countIf(clv_24h_weighted > 0.10) as very_strong_clv
      FROM pm_wallet_forecaster_candidates_60d
    `,
    format: 'JSONEachRow',
  });
  const stats = (await statsQ.json()) as any[];
  console.log(`   Total eligible: ${Number(stats[0]?.total).toLocaleString()}`);
  console.log(`   Tier A (CLOB-primary): ${Number(stats[0]?.tier_a).toLocaleString()}`);
  console.log(`   Tier B (medium): ${Number(stats[0]?.tier_b).toLocaleString()}`);
  console.log(`   Tier C (external-heavy): ${Number(stats[0]?.tier_c).toLocaleString()}`);
  console.log(`   Positive CLV: ${Number(stats[0]?.positive_clv).toLocaleString()}`);
  console.log(`   Strong CLV (>5%): ${Number(stats[0]?.strong_clv).toLocaleString()}`);
  console.log(`   Very strong CLV (>10%): ${Number(stats[0]?.very_strong_clv).toLocaleString()}`);

  // Step 3: Top 20 overall
  console.log('\n3. Top 20 Super Forecasters (by CLV):');
  const topQ = await ch.query({
    query: `
      SELECT
        wallet,
        n_trades_60d,
        p24_coverage,
        clv_24h_weighted,
        clv_24h_hit_rate,
        notional_60d,
        confidence_tier
      FROM pm_wallet_forecaster_candidates_60d
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });
  const top = (await topQ.json()) as any[];

  console.log('   ' + '-'.repeat(120));
  console.log('   Wallet                                    | Trades | Cov  | CLV     | Hit% | Volume    | Tier');
  console.log('   ' + '-'.repeat(120));
  for (const w of top) {
    const wallet = w.wallet.slice(0, 42);
    const trades = String(w.n_trades_60d).padStart(6);
    const cov = (w.p24_coverage * 100).toFixed(0).padStart(3) + '%';
    const clv = w.clv_24h_weighted?.toFixed(4).padStart(7);
    const hit = (w.clv_24h_hit_rate * 100).toFixed(0).padStart(3) + '%';
    const vol = ('$' + Number(w.notional_60d).toFixed(0)).padStart(10);
    console.log(`   ${wallet} | ${trades} | ${cov} | ${clv} | ${hit} | ${vol} | ${w.confidence_tier}`);
  }

  // Step 4: Top 10 Tier A only
  console.log('\n4. Top 10 Tier A (CLOB-primary, highest confidence):');
  const topAQ = await ch.query({
    query: `
      SELECT
        wallet,
        n_trades_60d,
        p24_coverage,
        clv_24h_weighted,
        clv_24h_hit_rate,
        notional_60d
      FROM pm_wallet_forecaster_candidates_60d
      WHERE confidence_tier = 'A'
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const topA = (await topAQ.json()) as any[];

  console.log('   ' + '-'.repeat(110));
  for (const w of topA) {
    const wallet = w.wallet.slice(0, 42);
    const trades = String(w.n_trades_60d).padStart(6);
    const cov = (w.p24_coverage * 100).toFixed(0).padStart(3) + '%';
    const clv = w.clv_24h_weighted?.toFixed(4).padStart(7);
    const hit = (w.clv_24h_hit_rate * 100).toFixed(0).padStart(3) + '%';
    const vol = ('$' + Number(w.notional_60d).toFixed(0)).padStart(10);
    console.log(`   ${wallet} | ${trades} | ${cov} | ${clv} | ${hit} | ${vol}`);
  }

  console.log('\n=== Leaderboard view created! ===');
  console.log('\nQuery examples:');
  console.log('  Top 10k discovery: SELECT * FROM pm_wallet_forecaster_candidates_60d LIMIT 10000');
  console.log('  Top 1k Tier A: SELECT * FROM pm_wallet_forecaster_candidates_60d WHERE confidence_tier = \'A\' LIMIT 1000');

  await ch.close();
}

main().catch(console.error);
