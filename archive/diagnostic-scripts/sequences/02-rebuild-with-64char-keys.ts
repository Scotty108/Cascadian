import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 2: REBUILD ALL TABLES/VIEWS WITH 64-CHAR HEX KEYS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 2.1: Rebuild ctf_to_market_bridge with 64-char keys
  console.log('2.1: Rebuilding ctf_to_market_bridge_mat...');

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS ctf_to_market_bridge_mat`
  });

  await clickhouse.command({
    query: `
      CREATE TABLE ctf_to_market_bridge_mat
      (
        condition_id_ctf_hex64    String,
        condition_id_market_hex64 String
      )
      ENGINE = ReplacingMergeTree
      ORDER BY condition_id_ctf_hex64 AS
      SELECT
        lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') AS condition_id_ctf_hex64,
        anyHeavy(lower(replaceAll(condition_id, '0x', ''))) AS condition_id_market_hex64
      FROM clob_fills
      WHERE asset_id NOT IN ('asset', '')
      GROUP BY condition_id_ctf_hex64
    `
  });

  const bridgeCountQuery = await clickhouse.query({
    query: `SELECT count() AS cnt FROM ctf_to_market_bridge_mat`,
    format: 'JSONEachRow'
  });
  const bridgeCount = await bridgeCountQuery.json();
  console.log(`   ✅ Bridge rebuilt: ${bridgeCount[0].cnt} mappings\n`);

  // Step 2.2: Rebuild token_per_share_payout with 64-char keys
  console.log('2.2: Rebuilding token_per_share_payout view...');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW token_per_share_payout AS
      SELECT
        b.condition_id_ctf_hex64 AS condition_id_ctf,
        arrayMap(
          i -> toFloat64(r.payout_numerators[i]) / nullIf(toFloat64(r.payout_denominator), 0.0),
          arrayEnumerate(r.payout_numerators)
        ) AS pps
      FROM market_resolutions_final r
      JOIN ctf_to_market_bridge_mat b
        ON b.condition_id_market_hex64 = lower(r.condition_id_norm)
    `
  });

  const tpsCountQuery = await clickhouse.query({
    query: `SELECT count() AS cnt FROM token_per_share_payout`,
    format: 'JSONEachRow'
  });
  const tpsCount = await tpsCountQuery.json();
  console.log(`   ✅ token_per_share_payout rebuilt: ${tpsCount[0].cnt} entries\n`);

  // Step 2.3: Rebuild wallet_token_flows with 64-char keys
  console.log('2.3: Rebuilding wallet_token_flows view...');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_token_flows AS
      SELECT
        lower(coalesce(cf.user_eoa, cf.proxy_wallet)) AS wallet,
        lpad(lower(hex(bitShiftRight(toUInt256(cf.asset_id), 8))), 64, '0') AS condition_id_ctf,
        toUInt16(bitAnd(toUInt256(cf.asset_id), 255)) AS index_set_mask,
        sumIf(toFloat64(cf.size) / 1e6, cf.side = 'BUY')
          - sumIf(toFloat64(cf.size) / 1e6, cf.side = 'SELL') AS net_shares,
        sumIf(-toFloat64(cf.size) / 1e6 * toFloat64(cf.price), cf.side = 'BUY')
          + sumIf(toFloat64(cf.size) / 1e6 * toFloat64(cf.price), cf.side = 'SELL') AS gross_cf,
        sum(toFloat64(cf.size) / 1e6 * toFloat64(cf.price)
            * coalesce(cf.fee_rate_bps, 0) / 10000.0) AS fees
      FROM (SELECT * FROM clob_fills WHERE asset_id NOT IN ('asset', '')) cf
      GROUP BY wallet, condition_id_ctf, index_set_mask
    `
  });

  console.log(`   ✅ wallet_token_flows rebuilt\n`);

  // Step 2.4: Rebuild wallet_condition_pnl_token with 64-char keys
  console.log('2.4: Rebuilding wallet_condition_pnl_token view...');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_condition_pnl_token AS
      SELECT
        f.wallet,
        f.condition_id_ctf,
        f.index_set_mask,
        f.net_shares,
        f.gross_cf,
        f.fees,
        arraySum(arrayMap(
          j -> if(bitAnd(f.index_set_mask, bitShiftLeft(1, j)) > 0,
                  coalesce(arrayElement(t.pps, j + 1), 0.0), 0.0),
          range(length(coalesce(t.pps, [])))
        )) * f.net_shares AS realized_payout,
        f.gross_cf - f.fees + realized_payout AS pnl_net
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t USING (condition_id_ctf)
    `
  });

  console.log(`   ✅ wallet_condition_pnl_token rebuilt\n`);

  // Step 2.5: Rebuild wallet_condition_pnl (aggregated)
  console.log('2.5: Rebuilding wallet_condition_pnl view...');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_condition_pnl AS
      SELECT
        wallet,
        condition_id_ctf,
        sum(net_shares) AS net_shares,
        sum(gross_cf) AS gross_cf,
        sum(fees) AS fees,
        sum(realized_payout) AS realized_payout,
        sum(pnl_net) AS pnl_net
      FROM wallet_condition_pnl_token
      GROUP BY wallet, condition_id_ctf
    `
  });

  console.log(`   ✅ wallet_condition_pnl rebuilt\n`);

  // Step 2.6: Rebuild wallet_realized_pnl
  console.log('2.6: Rebuilding wallet_realized_pnl view...');

  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_realized_pnl AS
      SELECT
        wallet,
        sum(gross_cf) AS gross_cf,
        sum(fees) AS fees,
        sum(realized_payout) AS realized_payout,
        sum(pnl_net) AS pnl_net
      FROM wallet_condition_pnl
      GROUP BY wallet
    `
  });

  console.log(`   ✅ wallet_realized_pnl rebuilt\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 2 COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('All tables and views now use consistent 64-char hex keys!\n');
}

main().catch(console.error);
