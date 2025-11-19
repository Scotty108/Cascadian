import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

/**
 * Rebuild P&L with Correct CTF Mask-Based Logic
 *
 * Key corrections:
 * 1. Low 8 bits are index_set_mask (bitmask), not ordinal outcome_index
 * 2. Payout = sum of payout_numerators[j] for all bits j set in mask
 * 3. Key everything on true CTF condition_id from token decoding
 * 4. Bridge CTF id → market id once at the edge
 */

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REBUILDING P&L WITH MASK-BASED CTF LOGIC');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check wallet field
  console.log('Pre-check: Identifying correct wallet field...');
  const walletFieldQuery = await clickhouse.query({
    query: `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = 'clob_fills' AND (name = 'user_eoa' OR name = 'proxy_wallet')`,
    format: 'JSONEachRow'
  });
  const walletFields = await walletFieldQuery.json();
  const walletField = walletFields.find((f: any) => f.name === 'user_eoa')
    ? 'user_eoa'
    : 'proxy_wallet';
  console.log(`   Using: ${walletField}\n`);

  // Step 1: Create ctf_token_map_v2 view (corrected schema)
  console.log('Step 1: Creating ctf_token_map_v2 view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW ctf_token_map_v2 AS
      SELECT
        token_id,
        lower(hex(bitShiftRight(toUInt256(token_id), 8))) AS condition_id_ctf,
        toUInt16(bitAnd(toUInt256(token_id), 255))        AS index_set_mask,
        source,
        created_at
      FROM ctf_token_map
    `
  });
  console.log('   ✅ ctf_token_map_v2 created\n');

  // Step 2: Build cid_bridge (CTF id → market id)
  console.log('Step 2: Building cid_bridge view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW cid_bridge AS
      SELECT
        lower(hex(bitShiftRight(toUInt256(cf.asset_id), 8))) AS condition_id_ctf,
        anyHeavy(replaceAll(lower(cf.condition_id), '0x', '')) AS condition_id_market
      FROM clob_fills cf
      WHERE cf.asset_id != 'asset'
        AND cf.asset_id IS NOT NULL
        AND cf.condition_id IS NOT NULL
        AND cf.condition_id != ''
      GROUP BY condition_id_ctf
    `
  });
  console.log('   ✅ cid_bridge created\n');

  // Get bridge stats
  const bridgeStatsQuery = await clickhouse.query({
    query: 'SELECT count() AS ctf_conditions, count(DISTINCT condition_id_market) AS market_conditions FROM cid_bridge',
    format: 'JSONEachRow'
  });
  const bridgeStats = await bridgeStatsQuery.json();
  console.log(`   Bridge stats: ${bridgeStats[0].ctf_conditions} CTF conditions → ${bridgeStats[0].market_conditions} market conditions\n`);

  // Step 3: Create winners view (keyed by CTF id)
  console.log('Step 3: Creating winners view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW winners AS
      SELECT
        b.condition_id_ctf AS condition_id_ctf,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        1 AS is_resolved
      FROM market_resolutions_final r
      JOIN cid_bridge b
        ON b.condition_id_market = r.condition_id_norm
      WHERE r.payout_denominator > 0
    `
  });
  console.log('   ✅ winners created\n');

  // Get winners stats
  const winnersStatsQuery = await clickhouse.query({
    query: 'SELECT count() AS resolved_ctf_conditions FROM winners',
    format: 'JSONEachRow'
  });
  const winnersStats = await winnersStatsQuery.json();
  console.log(`   Resolved CTF conditions: ${winnersStats[0].resolved_ctf_conditions}\n`);

  // Step 4: Create token_per_share_payout view
  console.log('Step 4: Creating token_per_share_payout view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW token_per_share_payout AS
      SELECT
        w.condition_id_ctf,
        arrayMap(
          j -> toFloat64(w.payout_numerators[j + 1]) / nullIf(toFloat64(w.payout_denominator), 0.0),
          range(length(w.payout_numerators))
        ) AS pps,
        w.winning_index
      FROM winners w
    `
  });
  console.log('   ✅ token_per_share_payout created\n');

  // Step 5: Create wallet_token_flows view
  console.log('Step 5: Creating wallet_token_flows view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_token_flows AS
      SELECT
        lower(cf.${walletField}) AS wallet,
        lower(hex(bitShiftRight(toUInt256(cf.asset_id), 8))) AS condition_id_ctf,
        toUInt16(bitAnd(toUInt256(cf.asset_id), 255))        AS index_set_mask,
        sumIf(toFloat64(cf.size), cf.side = 'BUY')
          - sumIf(toFloat64(cf.size), cf.side = 'SELL')       AS net_shares,
        sumIf(-toFloat64(cf.size * cf.price), cf.side = 'BUY')
          + sumIf(toFloat64(cf.size * cf.price), cf.side = 'SELL') AS gross_cf,
        sum(toFloat64(cf.size * cf.price * coalesce(cf.fee_rate_bps, 0) / 10000.0)) AS fees
      FROM clob_fills cf
      WHERE cf.asset_id != 'asset'
        AND cf.asset_id IS NOT NULL
        AND cf.${walletField} IS NOT NULL
      GROUP BY wallet, condition_id_ctf, index_set_mask
    `
  });
  console.log('   ✅ wallet_token_flows created\n');

  // Get flow stats
  const flowStatsQuery = await clickhouse.query({
    query: 'SELECT count() AS position_count, count(DISTINCT wallet) AS unique_wallets FROM wallet_token_flows',
    format: 'JSONEachRow'
  });
  const flowStats = await flowStatsQuery.json();
  console.log(`   Position count: ${flowStats[0].position_count}, Unique wallets: ${flowStats[0].unique_wallets}\n`);

  // Step 6: Create wallet_condition_pnl view (THE KEY: MASK-BASED PAYOUT)
  console.log('Step 6: Creating wallet_condition_pnl view with mask-based payout...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_condition_pnl AS
      SELECT
        f.wallet,
        f.condition_id_ctf,
        any(f.gross_cf) AS gross_cf,
        any(f.fees)     AS fees,
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
        any(f.gross_cf) + coalesce(arraySum(
          arrayMap(
            j -> if(
              bitAnd(any(f.index_set_mask), bitShiftLeft(1, j)) > 0,
              coalesce(arrayElement(any(t.pps), j + 1), 0.0),
              0.0
            ),
            range(length(any(t.pps)))
          )
        ), 0.0) * any(f.net_shares) AS pnl_gross,
        any(f.gross_cf) - any(f.fees) + coalesce(arraySum(
          arrayMap(
            j -> if(
              bitAnd(any(f.index_set_mask), bitShiftLeft(1, j)) > 0,
              coalesce(arrayElement(any(t.pps), j + 1), 0.0),
              0.0
            ),
            range(length(any(t.pps)))
          )
        ), 0.0) * any(f.net_shares) AS pnl_net
      FROM wallet_token_flows f
      JOIN token_per_share_payout t
        ON t.condition_id_ctf = f.condition_id_ctf
      GROUP BY f.wallet, f.condition_id_ctf
    `
  });
  console.log('   ✅ wallet_condition_pnl created\n');

  // Step 7: Create wallet_realized_pnl view (final aggregation)
  console.log('Step 7: Creating wallet_realized_pnl view...');
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW wallet_realized_pnl AS
      SELECT
        wallet,
        round(sum(pnl_gross), 2) AS pnl_gross,
        round(sum(pnl_net), 2)   AS pnl_net
      FROM wallet_condition_pnl
      GROUP BY wallet
    `
  });
  console.log('   ✅ wallet_realized_pnl created\n');

  // Get final stats
  const pnlStatsQuery = await clickhouse.query({
    query: 'SELECT count() AS wallets_with_pnl, sum(pnl_net) AS total_pnl_net FROM wallet_realized_pnl',
    format: 'JSONEachRow'
  });
  const pnlStats = await pnlStatsQuery.json();
  console.log(`   Wallets with P&L: ${pnlStats[0].wallets_with_pnl}`);
  console.log(`   Total net P&L: $${Number(pnlStats[0].total_pnl_net).toLocaleString()}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('✅ ALL VIEWS CREATED - MASK-BASED P&L SYSTEM READY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Next: Run validation on target wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
}

main().catch(console.error);
