import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function analyzeConditionIdFormats() {
  console.log('\n🔍 CONDITION_ID FORMAT ANALYSIS');

  // Key insight: clob_fills vs market_resolutions_final
  const clobFormats = await clickhouse.query({
    query: `
      SELECT
        startsWith(condition_id, '0x') as has_prefix,
        length(condition_id) as len,
        count(*) as freq,
        min(timestamp) as earliest,
        max(timestamp) as latest,
        substr(condition_id, 1, 4) as sample_start
      FROM clob_fills
      GROUP BY has_prefix, len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('clob_fills.condition_id formats:', await clobFormats.json());

  const resolutionFormats = await clickhouse.query({
    query: `SELECT length(condition_id_norm) as len, count(*) as freq FROM market_resolutions_final GROUP BY len ORDER BY freq DESC`,
    format: 'JSONEachRow'
  });
  console.log('market_resolutions_final.condition_id_norm formats:', await resolutionFormats.json());

  const gammaFormats = await clickhouse.query({
    query: `
      SELECT
        startsWith(condition_id, '0x') as has_prefix,
        length(condition_id) as len,
        count(*) as freq,
        substr(condition_id, 1, 4) as sample_start
      FROM gamma_markets
      GROUP BY has_prefix, len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('gamma_markets.condition_id formats:', await gammaFormats.json());

  const ctfFormats = await clickhouse.query({
    query: `SELECT length(condition_id_norm) as len, count(*) as freq FROM ctf_token_map GROUP BY len ORDER BY freq DESC`,
    format: 'JSONEachRow'
  });
  console.log('ctf_token_map.condition_id_norm formats:', await ctfFormats.json());
}

async function analyzeTokenIdFormats() {
  console.log('\n🔍 TOKEN_ID FORMAT ANALYSIS');

  // Key insight: erc1155 token_id vs clob_fills asset_id
  const ercFormats = await clickhouse.query({
    query: `
      SELECT
        startsWith(token_id, '0x') as has_prefix,
        length(token_id) as len,
        count(*) as freq,
        min(block_timestamp) as earliest,
        max(block_timestamp) as latest,
        substr(token_id, 1, 4) as sample_start
      FROM erc1155_transfers
      GROUP BY has_prefix, len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('erc1155_transfers.token_id formats:', await ercFormats.json());

  const assetFormats = await clickhouse.query({
    query: `
      SELECT
        startsWith(asset_id, '0x') as has_prefix,
        length(asset_id) as len,
        count(*) as freq,
        min(timestamp) as earliest,
        max(timestamp) as latest,
        substr(asset_id, 1, 4) as sample_start
      FROM clob_fills
      GROUP BY has_prefix, len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('clob_fills.asset_id formats:', await assetFormats.json());

  const gammaTokenFormats = await clickhouse.query({
    query: `
      SELECT
        startsWith(token_id, '0x') as has_prefix,
        length(token_id) as len,
        count(*) as freq
      FROM gamma_markets
      GROUP BY has_prefix, len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('gamma_markets.token_id formats:', await gammaTokenFormats.json());

  const ctfTokenFormats = await clickhouse.query({
    query: `
      SELECT
        startsWith(token_id, '0x') as has_prefix,
        length(token_id) as len,
        count(*) as freq
      FROM ctf_token_map
      GROUP BY has_prefix, len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('ctf_token_map.token_id formats:', await ctfTokenFormats.json());
}

async function analyzeRecentVsHistoricalFormats() {
  console.log('\n🔍 RECENT vs HISTORICAL FORMAT DRIFT');

  // Analyze id format drift over time in clob_fills
  const recentVsHistorical = await clickhouse.query({
    query: `
      SELECT
        case when timestamp >= '2025-08-01' then 'recent' else 'historical' end as period,
        startsWith(condition_id, '0x') as has_prefix,
        length(condition_id) as len,
        count(*) as freq
      FROM clob_fills
      WHERE timestamp >= '2022-01-01'
      GROUP BY period, has_prefix, len
      ORDER BY period, freq DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  console.log('clob_fills condition_id format drift:', await recentVsHistorical.json());

  // Analyze erc1155 token format drift
  const ercFormatDrift = await clickhouse.query({
    query: `
      SELECT
        case when block_timestamp >= '2025-08-01' then 'recent' else 'historical' end as period,
        startsWith(token_id, '0x') as has_prefix,
        length(token_id) as len,
        count(*) as freq
      FROM erc1155_transfers
      WHERE block_timestamp >= '2022-01-01'
      GROUP BY period, has_prefix, len
      ORDER BY period, freq DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  console.log('erc1155 token_id format drift:', await ercFormatDrift.json());
}

async function xcnstrategyJoinFailureAnalysis() {
  console.log('\n🔍 XCNSTRATEGY JOIN FAILURE INVESTIGATION');

  const walletAddress = '0x6b486174c5a8cf5c6917e1b8b2c64b08425f1a80';

  // 1. Check xcnstrategy recent trades
  const recentTrades = await clickhouse.query({
    query: `
      SELECT
        DISTINCT asset_id,
        length(asset_id) as asset_len,
        startsWith(asset_id, '0x') as asset_has_prefix,
        condition_id,
        length(condition_id) as condition_len,
        timestamp
      FROM clob_fills
      WHERE order_owner = '${walletAddress}'
      ORDER BY timestamp DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('Xcnstrategy recent asset formats:', await recentTrades.json());

  // 2. Try join with different normalization approaches
  const joinAttempts = await clickhouse.query({
    query: `
      WITH xcn_trades AS (
        SELECT DISTINCT asset_id, condition_id
        FROM clob_fills
        WHERE order_owner = '${walletAddress}'
        LIMIT 10
      )
      SELECT
        'no_norm' as approach,
        COUNT(*) as joins_found
      FROM xcn_trades xt
      JOIN ctf_token_map ctf ON xt.asset_id = ctf.token_id

      UNION ALL

      SELECT
        'hex_normalize' as approach,
        COUNT(*) as joins_found
      FROM xcn_trades xt
      JOIN ctf_token_map ctf
        ON lower(replaceAll(xt.asset_id, '0x', '')) = lower(replaceAll(ctf.token_id, '0x', ''))

      UNION ALL

      SELECT
        'decode_to_hex' as approach,
        COUNT(*) as joins_found
      FROM xcn_trades xt
      JOIN ctf_token_map ctf
        ON LPAD(lower(hex(toUInt256(xt.asset_id))), 64, '0') = LPAD(ctf.token_id, 64, '0')
    `,
    format: 'JSONEachRow'
  });
  console.log('Join normalization test results:', await joinAttempts.json());

  // 3. Check specific asset_id decode
  const sampleDecode = await clickhouse.query({
    query: `SELECT hex(toUInt256('105392100504032111304134821100444646936144151941404393276849684670593970547907')) as decoded_hex`,
    format: 'JSONEachRow'
  });
  console.log('Sample asset_id decode:', await sampleDecode.json());
}

async function bridgeIntegrityValidation() {
  console.log('\n🔍 TRACK A BRIDGE INTEGRITY VALIDATION');

  // Test all join paths through normalization
  const bridgeTest = await clickhouse.query({
    query: `
      SELECT
        'clob_x_ctf' as bridge_path,
        COUNT(*) as join_count
      FROM (
        SELECT DISTINCT
          lower(replaceAll(asset_id, '0x', '')) as normalized_asset,
          lower(replaceAll(condition_id, '0x', '')) as normalized_condition
        FROM clob_fills
        LIMIT 1000
      ) cf
      LEFT JOIN ctf_token_map ctf ON cf.normalized_asset = lower(ctf.token_id)

      UNION ALL

      SELECT
        'ctf_x_gamma' as bridge_path,
        COUNT(*) as join_count
      FROM (
        SELECT DISTINCT lower(condition_id_norm) as normalized_condition
        FROM ctf_token_map
        LIMIT 1000
      ) ctf
      LEFT JOIN gamma_markets gm ON ctf.normalized_condition = lower(replaceAll(gm.condition_id, '0x', ''))

      UNION ALL

      SELECT
        'gamma_x_resolutions' as bridge_path,
        COUNT(*) as join_count
      FROM (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as normalized_condition
        FROM gamma_markets
        LIMIT 1000
      ) gm
      JOIN market_resolutions_final mr ON gm.normalized_condition = mr.condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  console.log('Bridge integrity results:', await bridgeTest.json());
}

async function main() {
  try {
    console.log('🔍 DEEP ID FORMAT NORMALIZATION ANALYSIS');

    await analyzeConditionIdFormats();
    await analyzeTokenIdFormats();
    await analyzeRecentVsHistoricalFormats();
    await xcnstrategyJoinFailureAnalysis();
    await bridgeIntegrityValidation();

    console.log('\n✅ Deep analysis complete!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();