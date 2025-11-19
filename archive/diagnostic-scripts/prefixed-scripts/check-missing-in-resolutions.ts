import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';
import { readFileSync } from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CHECK MISSING CTFs IN market_resolutions_final');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Read target CTF IDs
  const csv = readFileSync('tmp/phase7_missing_ctf64.csv', 'utf8');
  const lines = csv.split('\n').slice(1).filter(l => l.trim());
  const ctfIds = lines.map(l => l.split(',')[0]);

  console.log(`Target CTF IDs: ${ctfIds.length}\n`);

  for (const ctfId of ctfIds) {
    console.log(`Checking ${ctfId.substring(0, 20)}...`);

    // Check in market_resolutions_final
    const result = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          resolved_at
        FROM market_resolutions_final
        WHERE lower(condition_id_norm) = lower('${ctfId}')
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const rows: any[] = await result.json();

    if (rows.length > 0) {
      console.log(`   ✅ Found in market_resolutions_final`);
      console.log(`      payout_numerators: [${rows[0].payout_numerators.join(', ')}]`);
      console.log(`      payout_denominator: ${rows[0].payout_denominator}`);
    } else {
      console.log(`   ❌ NOT found in market_resolutions_final`);

      // Check gamma_resolved
      const gammaResult = await clickhouse.query({
        query: `
          SELECT cid, winning_outcome, closed, fetched_at
          FROM gamma_resolved
          WHERE lower(cid) = lower('${ctfId}')
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const gammaRows: any[] = await gammaResult.json();

      if (gammaRows.length > 0) {
        console.log(`   ⚠️  Found in gamma_resolved:`);
        console.log(`      winning_outcome: ${gammaRows[0].winning_outcome}`);
        console.log(`      closed: ${gammaRows[0].closed}`);
        console.log(`      fetched_at: ${gammaRows[0].fetched_at}`);
      } else {
        console.log(`   ❌ NOT found in gamma_resolved either`);
      }
    }

    console.log();
  }
}

main().catch(console.error);
