#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

/**
 * WALLET POSITION COUNT COMPARISON
 *
 * For each wallet:
 * 1. Count total positions (any market traded)
 * 2. Count resolved positions (markets with resolution data)
 * 3. Count "closed" positions (net_shares ≈ 0)
 * 4. Compare to Polymarket's reported position counts
 */

const wallets = [
  { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', pnl: 332563, gains: 333508, losses: 945 },
  { address: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', pnl: 114087, gains: 118922, losses: 4835 },
  { address: '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', pnl: 101576, gains: 109179, losses: 7603 },
  { address: '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', pnl: 216892, gains: 242781, losses: 25889 },
  { address: '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed', pnl: 211748, gains: 246401, losses: 34653 },
  { address: '0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f', pnl: 163277, gains: 191571, losses: 28294 },
  { address: '0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37', pnl: 73231, gains: 86678, losses: 13447 },
  { address: '0x12d6cccfc7470a3f4bafc53599a4779cbf2cf2a8', pnl: 150023, gains: 178457, losses: 28434 },
  { address: '0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db', pnl: 114134, gains: 136696, losses: 22562 },
  { address: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', pnl: 135153, gains: 174150, losses: 38997 },
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', pnl: 137663, gains: 145976, losses: 8313 }, // burrito338
];

async function analyzePositionCounts() {
  console.log('WALLET POSITION COUNT ANALYSIS');
  console.log('═'.repeat(100));
  console.log();

  const results = [];

  for (const wallet of wallets) {
    const stats = await client.query({
      query: `
        WITH positions AS (
          SELECT
            t.condition_id_norm,
            t.market_id_norm,
            t.outcome_index,
            sum(CASE WHEN t.trade_direction = 'BUY' THEN t.shares ELSE -t.shares END) as net_shares,
            sum(CASE WHEN t.trade_direction = 'BUY' THEN t.usd_value ELSE -t.usd_value END) as cost_basis,
            count() as num_trades
          FROM default.vw_trades_canonical t
          WHERE lower(t.wallet_address_norm) = lower('${wallet.address}')
            AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          GROUP BY t.condition_id_norm, t.market_id_norm, t.outcome_index
        ),
        resolved_positions AS (
          SELECT
            p.*,
            r.winning_index,
            r.payout_numerators,
            r.payout_denominator
          FROM positions p
          INNER JOIN cascadian_clean.vw_resolutions_unified r
            ON lower(p.condition_id_norm) = r.cid_hex
        )
        SELECT
          count(DISTINCT p.market_id_norm) as total_markets,
          count(DISTINCT p.condition_id_norm) as total_positions,
          count(DISTINCT r.market_id_norm) as resolved_markets,
          count(DISTINCT r.condition_id_norm) as resolved_positions,
          sum(CASE WHEN abs(r.net_shares) < 100 THEN 1 ELSE 0 END) as closed_positions,
          sum(CASE WHEN abs(r.net_shares) >= 100 THEN 1 ELSE 0 END) as open_at_resolution
        FROM positions p
        LEFT JOIN resolved_positions r
          ON p.condition_id_norm = r.condition_id_norm
          AND p.market_id_norm = r.market_id_norm
          AND p.outcome_index = r.outcome_index
      `,
      format: 'JSONEachRow',
    });

    const stat = (await stats.json<any[]>())[0];
    results.push({
      wallet: wallet.address,
      polymarket_pnl: wallet.pnl,
      polymarket_gains: wallet.gains,
      polymarket_losses: wallet.losses,
      ...stat
    });
  }

  console.log('Position Count Breakdown:');
  console.log('─'.repeat(100));
  console.log();
  console.log('Wallet'.padEnd(44) +
              'Total'.padEnd(8) +
              'Resolved'.padEnd(10) +
              'Closed'.padEnd(8) +
              'Open@Res'.padEnd(10) +
              'PM P&L');
  console.log('─'.repeat(100));

  for (const r of results) {
    const addr = r.wallet.slice(0, 10) + '...' + r.wallet.slice(-8);
    console.log(
      addr.padEnd(44) +
      r.total_positions.toString().padEnd(8) +
      r.resolved_positions.toString().padEnd(10) +
      r.closed_positions.toString().padEnd(8) +
      r.open_at_resolution.toString().padEnd(10) +
      '$' + r.polymarket_pnl.toLocaleString()
    );
  }

  console.log();
  console.log('═'.repeat(100));
  console.log('SUMMARY STATISTICS');
  console.log('═'.repeat(100));
  console.log();

  const avgTotal = results.reduce((sum, r) => sum + parseInt(r.total_positions), 0) / results.length;
  const avgResolved = results.reduce((sum, r) => sum + parseInt(r.resolved_positions), 0) / results.length;
  const avgClosed = results.reduce((sum, r) => sum + parseInt(r.closed_positions), 0) / results.length;
  const avgOpen = results.reduce((sum, r) => sum + parseInt(r.open_at_resolution), 0) / results.length;

  console.log('Average positions per wallet:');
  console.log('  Total positions:           ', avgTotal.toFixed(1));
  console.log('  Resolved positions:        ', avgResolved.toFixed(1));
  console.log('  Closed (net_shares < 100): ', avgClosed.toFixed(1));
  console.log('  Open at resolution:        ', avgOpen.toFixed(1));
  console.log();

  const resolvedPct = (avgResolved / avgTotal * 100).toFixed(1);
  const closedPct = (avgClosed / avgResolved * 100).toFixed(1);

  console.log('Ratios:');
  console.log('  Resolved / Total:          ', resolvedPct + '%');
  console.log('  Closed / Resolved:         ', closedPct + '%');
  console.log();

  console.log('═'.repeat(100));
  console.log('KEY INSIGHTS');
  console.log('═'.repeat(100));
  console.log();

  if (parseFloat(closedPct) < 20) {
    console.log('⚠️  Most positions are OPEN at resolution (held to payout)');
    console.log('   This explains why Polymarket shows fewer "closed" positions.');
    console.log('   Polymarket likely only counts positions with net_shares ≈ 0');
  } else if (parseFloat(closedPct) > 80) {
    console.log('✅ Most positions are CLOSED (traded back to zero)');
    console.log('   Position counts should match Polymarket closely');
  } else {
    console.log('📊 Mix of closed and open-at-resolution positions');
    console.log('   Polymarket counts may differ based on their filtering');
  }

  console.log();
  console.log('Next steps:');
  console.log('1. Get Polymarket position counts for these wallets (via API or UI)');
  console.log('2. Compare "Closed" count to Polymarket\'s position count');
  console.log('3. If counts match, test P&L calculations');
  console.log('4. If counts differ, investigate which positions we\'re counting extra');
  console.log();

  // Focus on burrito338 for detailed analysis
  console.log('═'.repeat(100));
  console.log('DETAILED ANALYSIS: burrito338 (0x1489...c1307)');
  console.log('═'.repeat(100));
  console.log();

  const burrito = results.find(r => r.wallet === '0x1489046ca0f9980fc2d9a950d103d3bec02c1307');
  if (burrito) {
    console.log('Our counts:');
    console.log('  Total positions:    ', burrito.total_positions);
    console.log('  Resolved positions: ', burrito.resolved_positions);
    console.log('  Closed positions:   ', burrito.closed_positions);
    console.log('  Open at resolution: ', burrito.open_at_resolution);
    console.log();
    console.log('Polymarket (from earlier):');
    console.log('  "Closed" tab shows: 75 positions');
    console.log();

    const matchPct = (parseInt(burrito.resolved_positions) / 75 * 100).toFixed(1);
    console.log('Match analysis:');
    console.log('  Our resolved / PM closed: ' + matchPct + '%');

    if (matchPct > 110) {
      console.log('  ⚠️  We have MORE positions than Polymarket shows');
      console.log('     Likely including positions Polymarket filters out');
    } else if (matchPct < 90) {
      console.log('  ⚠️  We have FEWER positions than Polymarket shows');
      console.log('     Possible data quality issue');
    } else {
      console.log('  ✅ Counts are very close - likely same positions');
    }
  }

  console.log();

  await client.close();
}

analyzePositionCounts().catch(console.error);
