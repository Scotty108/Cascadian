import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FIXING DECODE INTEGRITY AND BRIDGE TABLE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // First, verify the correct formula
  console.log('Step 1: Verifying correct decode formula');
  console.log('─'.repeat(60));

  const testQuery = await clickhouse.query({
    query: `
      WITH dec AS (
        SELECT
          lower(hex(toUInt256(asset_id))) AS token_hex,
          lower(hex(bitShiftRight(toUInt256(asset_id), 8))) AS ctf_hex_unpadded,
          lpad(lower(hex(bitAnd(toUInt256(asset_id),255))),2,'0') AS mask_hex
        FROM clob_fills WHERE asset_id NOT IN ('asset','') LIMIT 10000
      )
      SELECT
        count() AS n,
        countIf(token_hex = concat(lpad(ctf_hex_unpadded, 62, '0'), mask_hex)) AS ok_62,
        countIf(token_hex = concat(lpad(ctf_hex_unpadded, 64, '0'), mask_hex)) AS ok_64,
        ok_62*100.0/n AS pct_ok_62,
        ok_64*100.0/n AS pct_ok_64
      FROM dec
    `,
    format: 'JSONEachRow'
  });
  const test = await testQuery.json();

  console.log(`   With 62-char CTF: ${test[0].ok_62}/${test[0].n} = ${Number(test[0].pct_ok_62).toFixed(2)}%`);
  console.log(`   With 64-char CTF: ${test[0].ok_64}/${test[0].n} = ${Number(test[0].pct_ok_64).toFixed(2)}%`);

  if (test[0].pct_ok_62 === 100) {
    console.log(`   ✅ Confirmed: CTF should be 62 chars, not 64!\n`);
  } else {
    console.log(`   ❌ Neither formula works! Need to investigate further.\n`);
    return;
  }

  // Drop and recreate bridge table with correct padding
  console.log('Step 2: Recreating ctf_to_market_bridge_mat with 62-char CTF');
  console.log('─'.repeat(60));

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS ctf_to_market_bridge_mat`
  });
  console.log('   Dropped old bridge table');

  await clickhouse.command({
    query: `
      CREATE TABLE ctf_to_market_bridge_mat
      (
        condition_id_ctf    String,
        condition_id_market String
      )
      ENGINE = ReplacingMergeTree ORDER BY condition_id_ctf AS
      SELECT
        lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 62, '0') AS condition_id_ctf,
        anyHeavy(lower(replaceAll(condition_id, '0x',''))) AS condition_id_market
      FROM
      (
        SELECT condition_id, asset_id
        FROM clob_fills
        WHERE asset_id NOT IN ('asset','')
      ) f
      GROUP BY condition_id_ctf
    `
  });
  console.log('   ✅ Created new bridge table with 62-char CTF IDs\n');

  // Verify bridge
  const bridgeCountQuery = await clickhouse.query({
    query: `SELECT count() AS total FROM ctf_to_market_bridge_mat`,
    format: 'JSONEachRow'
  });
  const bridgeCount = await bridgeCountQuery.json();
  console.log(`   Bridge entries: ${bridgeCount[0].total}\n`);

  // Rebuild all downstream views with corrected CTF length
  console.log('Step 3: Rebuilding downstream views');
  console.log('─'.repeat(60));

  // Winners view
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW winners_ctf AS
      SELECT b.condition_id_ctf, r.payout_numerators, r.payout_denominator
      FROM market_resolutions_final r
      JOIN ctf_to_market_bridge_mat b
        ON b.condition_id_market = r.condition_id_norm
      WHERE length(r.payout_numerators) > 0
    `
  });
  console.log('   ✅ winners_ctf rebuilt');

  // Token per share payout
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW token_per_share_payout AS
      SELECT
        condition_id_ctf,
        arrayMap(i -> toFloat64(payout_numerators[i]) / nullIf(toFloat64(payout_denominator), 0.0),
                 arrayEnumerate(payout_numerators)) AS pps
      FROM winners_ctf
    `
  });
  console.log('   ✅ token_per_share_payout rebuilt');

  // Wallet token flows
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_token_flows AS
      SELECT
        lower(coalesce(cf.user_eoa, cf.proxy_wallet)) AS wallet,
        lpad(lower(hex(bitShiftRight(toUInt256(cf.asset_id), 8))), 62, '0') AS condition_id_ctf,
        toUInt16(bitAnd(toUInt256(cf.asset_id), 255)) AS index_set_mask,
        sumIf(toFloat64(cf.size)/1e6, cf.side='BUY')
          - sumIf(toFloat64(cf.size)/1e6, cf.side='SELL') AS net_shares,
        sumIf(-toFloat64(cf.size)/1e6*toFloat64(cf.price), cf.side='BUY')
          + sumIf(toFloat64(cf.size)/1e6*toFloat64(cf.price), cf.side='SELL') AS gross_cf,
        sum(toFloat64(cf.size)/1e6*toFloat64(cf.price)
            * coalesce(cf.fee_rate_bps,0)/10000.0) AS fees
      FROM
      (
        SELECT *
        FROM clob_fills
        WHERE asset_id NOT IN ('asset','')
      ) cf
      GROUP BY wallet, condition_id_ctf, index_set_mask
    `
  });
  console.log('   ✅ wallet_token_flows rebuilt (price NOT divided by 1e6)');

  // Token-level P&L
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_condition_pnl_token AS
      SELECT
        f.wallet, f.condition_id_ctf, f.index_set_mask,
        f.net_shares, f.gross_cf, f.fees,
        arraySum(arrayMap(j ->
          if(bitAnd(f.index_set_mask, bitShiftLeft(1, j-1))>0,
             coalesce(arrayElement(t.pps, j), 0.0), 0.0),
          arrayEnumerate(t.pps))) * f.net_shares AS realized_payout,
        f.gross_cf
        + arraySum(arrayMap(j ->
            if(bitAnd(f.index_set_mask, bitShiftLeft(1, j-1))>0,
               coalesce(arrayElement(t.pps, j), 0.0), 0.0),
            arrayEnumerate(t.pps))) * f.net_shares AS pnl_gross,
        f.gross_cf - f.fees
        + arraySum(arrayMap(j ->
            if(bitAnd(f.index_set_mask, bitShiftLeft(1, j-1))>0,
               coalesce(arrayElement(t.pps, j), 0.0), 0.0),
            arrayEnumerate(t.pps))) * f.net_shares AS pnl_net
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t USING (condition_id_ctf)
    `
  });
  console.log('   ✅ wallet_condition_pnl_token rebuilt');

  // Condition-level P&L
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_condition_pnl AS
      SELECT wallet, condition_id_ctf,
             sum(gross_cf) AS gross_cf, sum(fees) AS fees,
             sum(realized_payout) AS realized_payout,
             sum(pnl_gross) AS pnl_gross, sum(pnl_net) AS pnl_net
      FROM wallet_condition_pnl_token
      GROUP BY wallet, condition_id_ctf
    `
  });
  console.log('   ✅ wallet_condition_pnl rebuilt');

  // Wallet-level P&L
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_realized_pnl AS
      SELECT wallet,
             round(sum(pnl_gross),2) AS pnl_gross,
             round(sum(pnl_net),2) AS pnl_net
      FROM wallet_condition_pnl
      GROUP BY wallet
    `
  });
  console.log('   ✅ wallet_realized_pnl rebuilt\n');

  // Test target wallet
  console.log('Step 4: Testing target wallet');
  console.log('─'.repeat(60));

  const walletQuery = await clickhouse.query({
    query: `
      SELECT pnl_gross, pnl_net
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
    `,
    format: 'JSONEachRow'
  });
  const wallet = await walletQuery.json();

  if (wallet.length > 0) {
    console.log(`   Realized P&L: $${Number(wallet[0].pnl_net).toLocaleString()}`);
    console.log(`   DOME target: $87,030.51`);
    console.log(`   Variance: ${((Number(wallet[0].pnl_net) - 87030.51) / 87030.51 * 100).toFixed(2)}%\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ BRIDGE AND VIEWS REBUILT WITH CORRECT CTF LENGTH (62 chars)');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
