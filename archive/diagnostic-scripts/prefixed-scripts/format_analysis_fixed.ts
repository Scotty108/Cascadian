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
        length(condition_id) as len,
        count(*) as freq,
        min(timestamp) as earliest,
        max(timestamp) as latest,
        substr(condition_id, 1, 4) as sample_start
      FROM clob_fills
      GROUP BY len, substr(condition_id, 1, 4)
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
        length(condition_id) as len,
        count(*) as freq,
        substr(condition_id, 1, 4) as sample_start
      FROM gamma_markets
      GROUP BY len, substr(condition_id, 1, 4)
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

  // Check prefix patterns
  const clobPrefixes = await clickhouse.query({
    query: `SELECT substr(condition_id, 1, 2) as prefix, count(*) as freq FROM clob_fills GROUP BY prefix ORDER BY freq DESC LIMIT 5`,
    format: 'JSONEachRow'
  });
  console.log('clob_fills.condition_id prefix analysis:', await clobPrefixes.json());

  const gammaPrefixes = await clickhouse.query({
    query: `SELECT substr(condition_id, 1, 2) as prefix, count(*) as freq FROM gamma_markets GROUP BY prefix ORDER BY freq DESC LIMIT 5`,
    format: 'JSONEachRow'
  });
  console.log('gamma_markets.condition_id prefix analysis:', await gammaPrefixes.json());
}

async function analyzeTokenIdFormats() {
  console.log('\n🔍 TOKEN_ID FORMAT ANALYSIS');

  // Key insight: erc1155 token_id vs clob_fills asset_id
  const ercFormats = await clickhouse.query({
    query: `
      SELECT
        length(token_id) as len,
        count(*) as freq,
        min(block_timestamp) as earliest,
        max(block_timestamp) as latest,
        substr(token_id, 1, 4) as sample_start
      FROM erc1155_transfers
      GROUP BY len, substr(token_id, 1, 4)
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('erc1155_transfers.token_id formats:', await ercFormats.json());

  const assetFormats = await clickhouse.query({
    query: `
      SELECT
        length(asset_id) as len,
        count(*) as freq,
        min(timestamp) as earliest,
        max(timestamp) as latest,
        substr(asset_id, 1, 4) as sample_start
      FROM clob_fills
      GROUP BY len, substr(asset_id, 1, 4)
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('clob_fills.asset_id formats:', await assetFormats.json());

  const gammaTokenFormats = await clickhouse.query({
    query: `
      SELECT
        length(token_id) as len,
        count(*) as freq
      FROM gamma_markets
      GROUP BY len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('gamma_markets.token_id formats:', await gammaTokenFormats.json());

  const ctfTokenFormats = await clickhouse.query({
    query: `
      SELECT
        length(token_id) as len,
        count(*) as freq
      FROM ctf_token_map
      GROUP BY len
      ORDER BY freq DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('ctf_token_map.token_id formats:', await ctfTokenFormats.json());

  // Check if clob_fills asset_id is decimal vs hex
  const decimalCheck = await clickhouse.query({
    query: `
      SELECT
        substr(asset_id, 1, 1) as first_char,
        count(*) as freq
      FROM clob_fills
      WHERE length(asset_id) > 0
      GROUP BY first_char
      ORDER BY freq DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log('clob_fills.asset_id first character analysis:', await decimalCheck.json());
}

async function analyzeXcnstrategySpecifically() {
  console.log('\n🔍 XCNSTRATEGY JOIN FAILURE INVESTIGATION');

  const walletAddress = '0x6b486174c5a8cf5c6917e1b8b2c64b08425f1a80';

  // 1. Check xcnstrategy recent trades
  const recentActivity = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        length(asset_id) as asset_len,
        clamp(substr(asset_id, 1, 2), '0') as first_chars,
        condition_id,
        length(condition_id) as condition_len,
        timestamp
      FROM clob_fills
      WHERE order_owner = '${walletAddress}'
      ORDER BY timestamp DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log('Xcnstrategy recent formats:', await recentActivity.json());

  // 2. Test join strategies
  const sampleAssetId = '105392100504032111304134821100444646936144151941404393276849684670593970547907';

  // Try decimal-to-hex conversion
  const decimalToHex = await clickhouse.query({
    query: `SELECT toString('0x' || LOWER(HEX(${sampleAssetId}))) as hex_value`,
    format: 'JSONEachRow'
  });
  console.log('Sample asset_id decimal to hex:', await decimalToHex.json());

  // Check if we can find any matches with normalization
  const matchTest = await clickhouse.query({
    query: `
      SELECT
        cf.asset_id,
        ctf.token_id,
        case
          when toString('0x' || LOWER(HEX(toUInt256(cf.asset_id)))) = ctf.token_id then 'decimal_to_hex_match'
          when cf.asset_id = ctf.token_id then 'direct_match'
        end as match_type,
        cf.timestamp
      FROM clob_fills cf
      LEFT JOIN ctf_token_map ctf ON
        toString('0x' || LOWER(HEX(toUInt256(cf.asset_id)))) = ctf.token_id OR
        cf.asset_id = ctf.token_id
      WHERE cf.order_owner = '${walletAddress}'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  console.log('Asset-to-token ID matching test:', await matchTest.json());
}

async function testTokenConversion() {
  console.log('\n🧪 TOKEN CONVERSION TESTS');

  // Test specific asset_id to hex conversion
  const testCases = [
    '105392100504032111304134821100444646936144151941404393276849684670593970547907',
    '105655988261782688220369492260115230900730669635577830501712980607631224393260',
    '100000293804690815023609597660894660801582658691499546225810764430851148723524'
  ];

  for (const assetId of testCases) {
    const conversion = await clickhouse.query({
      query: `
        SELECT
          '${assetId}' as original,
          toString('0x' || LOWER(HEX(toUInt256('${assetId}')))) as to_hex,
          toString('0x' || LOWER(HEX(CAST('${assetId}' as String)))) as string_to_hex
      `,
      format: 'JSONEachRow'
    });
    console.log(`Asset ID ${assetId} conversions:`, await conversion.json());

    // Check if this exists in ctf_token_map
    const existence = await clickhouse.query({
      query: `SELECT token_id FROM ctf_token_map WHERE token_id = toString('0x' || LOWER(HEX(toUInt256('${assetId}'))) limit 1`,
      format: 'JSONEachRow'
    });
    console.log(`Exists in ctf_token_map:`, await existence.json());
  }
}

async function bridgeConnectionAnalysis() {
  console.log('\n🔗 BRIDGE CONNECTION VALIDATION');

  // Test bridge integrity between gamma_markets <-> ctf_token_map <-> clob_fills
  const connectionTest = await clickhouse.query({
    query: `
      -- Gamma to CTF bridge
      SELECT 'gamma_to_ctf' as connection,
             'condition_id' as key_type,
             COUNT(*) as matches
      FROM (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as normalized_condition
        FROM gamma_markets
        LIMIT 1000
      ) gm
      JOIN ctf_token_map ctf ON gm.normalized_condition = lower(ctf.condition_id_norm)

      UNION ALL

      -- CTF to Clob bridge (asset conversion)
      SELECT 'ctf_to_clob' as connection,
             'token_id_to_asset_id' as key_type,
             COUNT(*) as matches
      FROM (
        SELECT DISTINCT lower(replaceAll(token_id, '0x', '')) as token_id_norm
        FROM ctf_token_map
        LIMIT 1000
      ) ctf
      LEFT JOIN clob_fills cf ON ctf.token_id_norm = lower(replaceAll(toString('0x' || HEX(toUInt256(cf.asset_id))), '0x', ''))
      WHERE cf.fill_id IS NOT NULL

      UNION ALL

      -- Direct gamma to clob (should fail)
      SELECT 'gamma_direct_clob' as connection,
             'condition_id' as key_type,
             COUNT(*) as matches
      FROM (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as normalized_condition
        FROM gamma_markets
        LIMIT 1000
      ) gm
      LEFT JOIN clob_fills cf ON gm.normalized_condition = lower(replaceAll(cf.condition_id, '0x', ''))
      WHERE cf.fill_id IS NOT NULL
    `,
    format: 'JSONEachRow'
  });
  console.log('Bridge connection results:', await connectionTest.json());
}

async function main() {
  try {
    console.log('🔬 DETAILED ID NORMALIZATION ANALYSIS');

    await analyzeConditionIdFormats();
    await analyzeTokenIdFormats();
    await analyzeXcnstrategySpecifically();
    await testTokenConversion();
    await bridgeConnectionAnalysis();

    console.log('\n✅ Detailed analysis complete!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();