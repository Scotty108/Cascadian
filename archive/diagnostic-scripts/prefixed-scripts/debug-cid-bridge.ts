import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CID_BRIDGE DEBUG');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check a specific asset_id
  const assetId = '72016524934977102644827669188692754213186711249642025547408896104495709692655';
  const marketConditionId = '0xee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2';

  console.log(`Testing asset_id: ${assetId}`);
  console.log(`Expected market condition_id: ${marketConditionId}\n`);

  // Decode the asset_id
  const decodeQuery = await clickhouse.query({
    query: `
      SELECT
        lower(hex(bitShiftRight(toUInt256('${assetId}'), 8))) AS condition_id_ctf,
        length(lower(hex(bitShiftRight(toUInt256('${assetId}'), 8)))) AS ctf_len,
        toUInt16(bitAnd(toUInt256('${assetId}'), 255)) AS index_set_mask
    `,
    format: 'JSONEachRow'
  });
  const decoded = await decodeQuery.json();

  console.log('Decoded from asset_id:');
  console.log(`   condition_id_ctf: ${decoded[0].condition_id_ctf} (length: ${decoded[0].ctf_len})`);
  console.log(`   index_set_mask: ${decoded[0].index_set_mask}\n`);

  // Check what cid_bridge has for this CTF id
  const bridgeQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        condition_id_market
      FROM cid_bridge
      WHERE condition_id_ctf = '${decoded[0].condition_id_ctf}'
    `,
    format: 'JSONEachRow'
  });
  const bridge = await bridgeQuery.json();

  if (bridge.length > 0) {
    console.log('Found in cid_bridge:');
    console.log(`   condition_id_ctf: ${bridge[0].condition_id_ctf}`);
    console.log(`   condition_id_market: ${bridge[0].condition_id_market}\n`);
  } else {
    console.log('⚠️  NOT FOUND in cid_bridge!\n');
  }

  // Check what's actually in market_resolutions_final for this market
  const resolutionQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index
      FROM market_resolutions_final
      WHERE condition_id_norm = replaceAll(lower('${marketConditionId}'), '0x', '')
    `,
    format: 'JSONEachRow'
  });
  const resolution = await resolutionQuery.json();

  if (resolution.length > 0) {
    console.log('Found in market_resolutions_final:');
    console.log(`   condition_id_norm: ${resolution[0].condition_id_norm}`);
    console.log(`   payout_numerators: [${resolution[0].payout_numerators.join(', ')}]`);
    console.log(`   payout_denominator: ${resolution[0].payout_denominator}`);
    console.log(`   winning_index: ${resolution[0].winning_index}\n`);
  } else {
    console.log('⚠️  NOT FOUND in market_resolutions_final!\n');
  }

  // Now check what cid_bridge actually contains
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CID_BRIDGE CONTENTS SAMPLE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const bridgeSampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        length(condition_id_ctf) as ctf_len,
        condition_id_market,
        length(condition_id_market) as market_len
      FROM cid_bridge
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const bridgeSample = await bridgeSampleQuery.json();

  console.log('Sample cid_bridge entries:');
  bridgeSample.forEach((b: any, i: number) => {
    console.log(`${i + 1}. CTF: ${b.condition_id_ctf} (len: ${b.ctf_len})`);
    console.log(`   Market: ${b.condition_id_market} (len: ${b.market_len})\n`);
  });

  // Check padding issue - maybe we need to pad CTF id to 64 chars?
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PADDING ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const paddingQuery = await clickhouse.query({
    query: `
      SELECT
        lower(hex(bitShiftRight(toUInt256('${assetId}'), 8))) AS ctf_unpaded,
        lpad(lower(hex(bitShiftRight(toUInt256('${assetId}'), 8))), 64, '0') AS ctf_padded,
        length(lower(hex(bitShiftRight(toUInt256('${assetId}'), 8)))) AS unpadded_len,
        length(lpad(lower(hex(bitShiftRight(toUInt256('${assetId}'), 8))), 64, '0')) AS padded_len
    `,
    format: 'JSONEachRow'
  });
  const padding = await paddingQuery.json();

  console.log('Unpadded CTF: ' + padding[0].ctf_unpaded + ' (len: ' + padding[0].unpadded_len + ')');
  console.log('Padded CTF:   ' + padding[0].ctf_padded + ' (len: ' + padding[0].padded_len + ')\n');

  console.log('Market ID:    ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2\n');

  console.log('🔍 These are still completely different values!');
  console.log('    CTF and Market condition IDs are genuinely different identifiers.\n');
}

main().catch(console.error);
