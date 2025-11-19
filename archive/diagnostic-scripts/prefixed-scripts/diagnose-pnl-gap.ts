import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('P&L GAP DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Target: $87,030.51 | Current: ~$14,262.52 | Gap: ~6x\n`);

  // Check 1: Total trade count
  console.log('Check 1: Trade Coverage');
  console.log('─'.repeat(60));

  const tradesQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(side = 'BUY') as buy_count,
        countIf(side = 'SELL') as sell_count,
        sum(toFloat64(size)) / 1000000.0 as total_volume_shares
      FROM clob_fills
      WHERE lower(user_eoa) = lower('${wallet}')
        AND asset_id != 'asset'
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQuery.json();
  console.log(`   Total trades: ${trades[0].total_trades}`);
  console.log(`   Buy: ${trades[0].buy_count} | Sell: ${trades[0].sell_count}`);
  console.log(`   Total volume: ${Number(trades[0].total_volume_shares).toLocaleString()} shares\n`);

  // Check 2: Realized vs Unrealized P&L
  console.log('Check 2: Realized vs Unrealized P&L');
  console.log('─'.repeat(60));

  const realizedQuery = await clickhouse.query({
    query: `
      SELECT
        pnl_gross,
        pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const realized = await realizedQuery.json();
  console.log(`   Realized P&L (gross): $${Number(realized[0].pnl_gross).toLocaleString()}`);
  console.log(`   Realized P&L (net): $${Number(realized[0].pnl_net).toLocaleString()}\n`);

  // Check 3: Sample payout numerators - look for scale issues
  console.log('Check 3: Sample Payout Numerators (checking for scale)');
  console.log('─'.repeat(60));

  const payoutSampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index
      FROM market_resolutions_final
      WHERE condition_id_norm IN (
        SELECT condition_id_market
        FROM cid_bridge
        WHERE condition_id_ctf IN (
          SELECT condition_id_ctf
          FROM wallet_token_flows
          WHERE lower(wallet) = lower('${wallet}')
          LIMIT 5
        )
      )
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const payoutSamples = await payoutSampleQuery.json();
  console.log('   Sample resolutions:');
  if (payoutSamples.length === 0) {
    console.log('   ⚠️  No resolution data found for wallet tokens!\n');
  } else {
    payoutSamples.forEach((p: any, i: number) => {
      if (p.payout_numerators && p.payout_denominator) {
        const pps = p.payout_numerators.map((n: number) => n / p.payout_denominator);
        console.log(`   ${i + 1}. ${p.condition_id_norm.substring(0, 12)}...`);
        console.log(`      numerators: [${p.payout_numerators.join(', ')}]`);
        console.log(`      denominator: ${p.payout_denominator}`);
        console.log(`      pps: [${pps.map((x: number) => x.toFixed(6)).join(', ')}]`);
        console.log(`      winning_index: ${p.winning_index}`);
      } else {
        console.log(`   ${i + 1}. ${p.condition_id_norm?.substring(0, 12)}... - ⚠️ Missing payout data`);
      }
    });
    console.log();
  }

  // Check 4: Top markets by gross cashflow (before payout)
  console.log('Check 4: Top Markets by |Gross Cashflow|');
  console.log('─'.repeat(60));

  const topCashflowQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        net_shares,
        gross_cf,
        fees
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY abs(gross_cf) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topCashflow = await topCashflowQuery.json();
  console.log('   Top 10 markets by |gross_cf|:');
  let totalGrossCf = 0;
  topCashflow.forEach((m: any, i: number) => {
    console.log(`   ${(i + 1).toString().padStart(2)}. ${m.condition_id_ctf.substring(0, 12)}... : ` +
      `net_shares=${Number(m.net_shares).toFixed(2).padStart(10)}, ` +
      `gross_cf=$${Number(m.gross_cf).toFixed(2).padStart(10)}`);
    totalGrossCf += Number(m.gross_cf);
  });
  console.log(`\n   Sum of top 10 gross_cf: $${totalGrossCf.toFixed(2)}\n`);

  // Check 5: Check if realized_payout is too small
  console.log('Check 5: Realized Payout Analysis');
  console.log('─'.repeat(60));

  const payoutAnalysisQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        net_shares,
        realized_payout,
        gross_cf,
        pnl_net
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
      ORDER BY abs(realized_payout) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const payoutAnalysis = await payoutAnalysisQuery.json();
  console.log('   Top 10 markets by |realized_payout|:');
  let totalPayout = 0;
  payoutAnalysis.forEach((m: any, i: number) => {
    console.log(`   ${(i + 1).toString().padStart(2)}. ${m.condition_id_ctf.substring(0, 12)}... : ` +
      `net_shares=${Number(m.net_shares).toFixed(2).padStart(10)}, ` +
      `payout=$${Number(m.realized_payout).toFixed(2).padStart(10)}, ` +
      `pnl=$${Number(m.pnl_net).toFixed(2).padStart(10)}`);
    totalPayout += Number(m.realized_payout);
  });
  console.log(`\n   Sum of top 10 realized_payout: $${totalPayout.toFixed(2)}\n`);

  // Check 6: Compare component totals
  console.log('Check 6: Component Totals');
  console.log('─'.repeat(60));

  const componentsQuery = await clickhouse.query({
    query: `
      SELECT
        sum(gross_cf) as total_gross_cf,
        sum(fees) as total_fees,
        sum(realized_payout) as total_payout
      FROM wallet_condition_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const components = await componentsQuery.json();
  console.log(`   Total gross_cf: $${Number(components[0].total_gross_cf).toLocaleString()}`);
  console.log(`   Total fees: $${Number(components[0].total_fees).toLocaleString()}`);
  console.log(`   Total realized_payout: $${Number(components[0].total_payout).toLocaleString()}`);
  console.log(`   Formula: gross_cf - fees + realized_payout = pnl_net`);
  console.log(`   Expected: ${Number(components[0].total_gross_cf).toFixed(2)} - ${Number(components[0].total_fees).toFixed(2)} + ${Number(components[0].total_payout).toFixed(2)}`);
  console.log(`   = $${(Number(components[0].total_gross_cf) - Number(components[0].total_fees) + Number(components[0].total_payout)).toFixed(2)}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('HYPOTHESIS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('If total_payout is very small compared to gross_cf, the issue is likely:');
  console.log('  1. Payout calculation is wrong (mask logic issue)');
  console.log('  2. payout_numerators have wrong scale');
  console.log('  3. Missing resolution data for winning positions\n');
}

main().catch(console.error);
