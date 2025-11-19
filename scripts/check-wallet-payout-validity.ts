#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  const wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('CHECKING IF WALLET IDS HAVE VALID vs INVALID PAYOUTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const result = await ch.query({
    query: `
      WITH wallet_ids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet}')
          AND condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        count(*) as total_ids,
        countIf(m.condition_id_norm IS NOT NULL) as found_in_market_res,
        countIf(m.payout_denominator > 0) as with_denominator,
        countIf(length(m.payout_numerators) > 0) as with_numerators,
        countIf(m.payout_denominator > 0 AND length(m.payout_numerators) > 0) as both_valid
      FROM wallet_ids w
      LEFT JOIN default.market_resolutions_final m
        ON w.cid = toString(m.condition_id_norm)
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<any[]>();
  console.log('Results:');
  console.log(`  Total wallet condition_ids: ${data[0].total_ids}`);
  console.log(`  Found in market_resolutions_final: ${data[0].found_in_market_res}`);
  console.log(`  With payout_denominator > 0: ${data[0].with_denominator}`);
  console.log(`  With non-empty numerators: ${data[0].with_numerators}`);
  console.log(`  With BOTH valid: ${data[0].both_valid}`);
  console.log('');

  if (parseInt(data[0].found_in_market_res) > 0 && parseInt(data[0].both_valid) === 0) {
    console.log('❌ FOUND THE ISSUE: Markets exist but have EMPTY/INVALID payout data!');
    console.log('');
    console.log('This means market_resolutions_final has rows for these markets,');
    console.log('but the payout_numerators and payout_denominator are empty/zero.');
    console.log('');
    console.log('Codex was right that 24.83% of markets have payouts, but this');
    console.log('specific wallet\'s markets are in the other 75.17% that DON\'T.');
    console.log('');
    console.log('Next step: Check gamma_resolved or fetch from external APIs.');
  } else if (parseInt(data[0].found_in_market_res) === 0) {
    console.log('⚠️  Markets NOT FOUND in market_resolutions_final at all');
    console.log('');
    console.log('Need to check other resolution tables or fetch externally.');
  }

  await ch.close();
}

main().catch(console.error);
