import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const CTFs = [
  '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
  '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
  '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
  '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
  '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e',
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SEARCH MARKETS BY BURN TIMESTAMP PROXIMITY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${WALLET}`);
  console.log(`CTFs to resolve: 5\n`);

  // Step 1: Get burn timestamps for each CTF
  console.log('Step 1: Finding burn timestamps for 5 CTFs...\n');

  const burnQuery = await clickhouse.query({
    query: `
      WITH target_ctfs AS (
        SELECT arrayJoin([
          '${CTFs[0]}',
          '${CTFs[1]}',
          '${CTFs[2]}',
          '${CTFs[3]}',
          '${CTFs[4]}'
        ]) AS ctf_64
      )
      SELECT
        lower(replaceAll(token_id, '0x', '')) AS ctf_64,
        max(block_timestamp) AS last_burn_ts,
        sum(toFloat64OrZero(value)) AS total_burned
      FROM default.erc1155_transfers
      WHERE lower(from_address) = lower('${WALLET}')
        AND lower(to_address) = '0x0000000000000000000000000000000000000000'
        AND lower(replaceAll(token_id, '0x', '')) IN (
          SELECT ctf_64 FROM target_ctfs
        )
      GROUP BY ctf_64
      ORDER BY last_burn_ts DESC
    `,
    format: 'JSONEachRow'
  });

  const burnRows: any[] = await burnQuery.json();

  if (burnRows.length === 0) {
    console.log('❌ No burn events found for any CTFs');
    console.log('   These CTFs were never burned by this wallet\n');
    console.log('   This explains why they have no resolution - wallet still holds them\n');
    console.log('   These are UNREALIZED positions, not resolved markets\n');
    return;
  }

  console.log(`Found burn events for ${burnRows.length}/5 CTFs:\n`);

  burnRows.forEach((row, i) => {
    console.log(`${i + 1}. CTF: ${row.ctf_64.substring(0, 20)}...`);
    console.log(`   Last burn: ${row.last_burn_ts}`);
    console.log(`   Total burned: ${row.total_burned}\n`);
  });

  // Step 2: For each burn timestamp, find nearby markets
  console.log('Step 2: Finding markets with similar timestamps...\n');

  for (const burn of burnRows) {
    console.log(`Searching for CTF ${burn.ctf_64.substring(0, 20)}...`);
    console.log(`Burn time: ${burn.last_burn_ts}\n`);

    const nearbyQuery = await clickhouse.query({
      query: `
        SELECT
          market_id AS slug,
          condition_id,
          question,
          resolved_at,
          abs(toUnixTimestamp(resolved_at) - toUnixTimestamp('${burn.last_burn_ts}')) AS time_diff_seconds
        FROM default.market_key_map
        WHERE resolved_at IS NOT NULL
          AND resolved_at BETWEEN '${burn.last_burn_ts}' - INTERVAL 30 DAY
                               AND '${burn.last_burn_ts}' + INTERVAL 30 DAY
        ORDER BY time_diff_seconds ASC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const nearby: any[] = await nearbyQuery.json();

    if (nearby.length === 0) {
      console.log('   ❌ No nearby markets found (±30 days)\n');
    } else {
      console.log(`   Found ${nearby.length} candidate markets:\n`);

      nearby.forEach((m, j) => {
        const daysDiff = Math.round(m.time_diff_seconds / 86400);
        console.log(`   ${j + 1}. ${m.slug}`);
        console.log(`      Question: ${m.question?.substring(0, 60) || 'N/A'}...`);
        console.log(`      Resolved: ${m.resolved_at}`);
        console.log(`      Time diff: ${daysDiff} days`);
        console.log(`      Condition ID: ${m.condition_id?.substring(0, 30) || 'N/A'}...\n`);
      });
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Burns found: ${burnRows.length}/5 CTFs`);
  console.log(`   No burns: ${5 - burnRows.length} CTFs\n`);

  if (burnRows.length < 5) {
    console.log(`⚠️  ${5 - burnRows.length} CTFs have NO burn events`);
    console.log('   These are likely UNREALIZED positions (not closed/resolved)\n');
    console.log('   Cannot calculate payout for positions that were never redeemed\n');
  }

  console.log('Next steps:');
  console.log('   1. Review candidate markets above');
  console.log('   2. Match by share counts and outcome patterns');
  console.log('   3. If matches found: insert market data and rebuild PnL');
  console.log('   4. If no matches: try Step 3 (scrape closed positions)\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
