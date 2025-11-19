import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Rebuilding downstream views after cid_bridge fix...\n');

  // Step 1: Rebuild winners view
  console.log('1. Rebuilding winners view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW winners AS
      SELECT
        b.condition_id_ctf,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        1 AS is_resolved
      FROM market_resolutions_final r
      JOIN cid_bridge b ON b.condition_id_market = r.condition_id_norm
    `
  });
  console.log('   ✅ winners view rebuilt\n');

  // Check winners count
  const winnersCountQuery = await clickhouse.query({
    query: `SELECT count() AS total FROM winners`,
    format: 'JSONEachRow'
  });
  const winnersCount = await winnersCountQuery.json();
  console.log(`   Total winners: ${winnersCount[0].total}\n`);

  // Step 2: Rebuild token_per_share_payout view
  console.log('2. Rebuilding token_per_share_payout view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW token_per_share_payout AS
      SELECT
        condition_id_ctf,
        arrayMap(
          j -> toFloat64(payout_numerators[j + 1]) / nullIf(toFloat64(payout_denominator), 0.0),
          range(length(payout_numerators))
        ) AS pps,
        winning_index
      FROM winners
    `
  });
  console.log('   ✅ token_per_share_payout view rebuilt\n');

  // Check token_per_share_payout count
  const tpsCountQuery = await clickhouse.query({
    query: `SELECT count() AS total FROM token_per_share_payout`,
    format: 'JSONEachRow'
  });
  const tpsCount = await tpsCountQuery.json();
  console.log(`   Total token_per_share_payout entries: ${tpsCount[0].total}\n`);

  // Step 3: Rebuild wallet_condition_pnl (which depends on token_per_share_payout)
  console.log('3. Rebuilding wallet_condition_pnl view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_condition_pnl AS
      SELECT
        f.wallet,
        f.condition_id_ctf,
        any(f.gross_cf) AS gross_cf,
        any(f.fees) AS fees,
        any(f.net_shares) AS net_shares,
        coalesce(arraySum(
          arrayMap(
            j -> if(
              bitAnd(any(f.index_set_mask), bitShiftLeft(1, j)) > 0,
              coalesce(arrayElement(any(t.pps), j + 1), 0.0),
              0.0
            ),
            range(length(any(t.pps)))
          )
        ), 0.0) * any(f.net_shares) AS realized_payout,
        any(f.gross_cf) + realized_payout AS pnl_gross,
        any(f.gross_cf) - any(f.fees) + realized_payout AS pnl_net
      FROM wallet_token_flows f
      JOIN token_per_share_payout t ON t.condition_id_ctf = f.condition_id_ctf
      GROUP BY f.wallet, f.condition_id_ctf
    `
  });
  console.log('   ✅ wallet_condition_pnl view rebuilt\n');

  // Step 4: Rebuild wallet_realized_pnl (which aggregates wallet_condition_pnl)
  console.log('4. Rebuilding wallet_realized_pnl view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_realized_pnl AS
      SELECT
        wallet,
        sum(pnl_gross) AS pnl_gross,
        sum(pnl_net) AS pnl_net
      FROM wallet_condition_pnl
      GROUP BY wallet
    `
  });
  console.log('   ✅ wallet_realized_pnl view rebuilt\n');

  // Test the target wallet
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  const pnlQuery = await clickhouse.query({
    query: `
      SELECT pnl_gross, pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const pnl = await pnlQuery.json();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('VALIDATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (pnl.length > 0) {
    const pnlNet = Number(pnl[0].pnl_net);
    const domeTarget = 87030.51;
    const variance = ((pnlNet - domeTarget) / domeTarget * 100).toFixed(2);

    console.log(`Target wallet P&L:`);
    console.log(`   P&L Gross: $${Number(pnl[0].pnl_gross).toLocaleString()}`);
    console.log(`   P&L Net:   $${pnlNet.toLocaleString()}`);
    console.log(`\nDome target: $${domeTarget.toLocaleString()}`);
    console.log(`Variance: ${variance}%`);

    if (Math.abs(Number(variance)) <= 2) {
      console.log(`\n✅ SUCCESS! P&L is within 2% of target!\n`);
    } else {
      console.log(`\n⚠️  Still outside target range (±2%)\n`);
    }
  } else {
    console.log('⚠️  Wallet not found in wallet_realized_pnl\n');
  }
}

main().catch(console.error);
