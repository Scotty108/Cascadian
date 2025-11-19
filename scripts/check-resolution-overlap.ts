#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('CHECKING SOURCE OVERLAP AND VOLUME\n');

  // Check overlap between resolution sources
  const overlap = await client.query({
    query: `
      WITH
        mrf AS (SELECT DISTINCT lower(condition_id_norm) as cid FROM default.market_resolutions_final),
        rei AS (SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid FROM default.resolutions_external_ingest)
      SELECT
        (SELECT count() FROM mrf) as mrf_total,
        (SELECT count() FROM rei) as rei_total,
        (SELECT count() FROM mrf INNER JOIN rei USING(cid)) as overlap,
        (SELECT count() FROM rei LEFT JOIN mrf USING(cid) WHERE mrf.cid IS NULL) as rei_only
    `,
    format: 'JSONEachRow'
  });
  const data = await overlap.json();
  console.log('market_resolutions_final vs resolutions_external_ingest:');
  console.log('  MRF unique:', data[0].mrf_total.toLocaleString());
  console.log('  REI unique:', data[0].rei_total.toLocaleString());
  console.log('  Overlap:', data[0].overlap.toLocaleString());
  console.log('  REI only (not in MRF):', data[0].rei_only.toLocaleString());
  console.log();

  // Check volume coverage
  const volume = await client.query({
    query: `
      WITH
        traded AS (
          SELECT
            lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
            sum(usd_value) as volume
          FROM default.vw_trades_canonical
          WHERE condition_id_norm != '' AND condition_id_norm IS NOT NULL
          GROUP BY cid_norm
        ),
        resolved AS (
          SELECT DISTINCT lower(condition_id_norm) as cid_norm
          FROM default.market_resolutions_final
        )
      SELECT
        sum(volume) as total_volume,
        sumIf(volume, cid_norm IN (SELECT cid_norm FROM resolved)) as resolved_volume,
        round(sumIf(volume, cid_norm IN (SELECT cid_norm FROM resolved)) * 100.0 / sum(volume), 2) as volume_coverage_pct
      FROM traded
    `,
    format: 'JSONEachRow'
  });
  const volData = await volume.json();
  console.log('VOLUME COVERAGE:');
  console.log('  Total volume: $' + (volData[0].total_volume / 1e9).toFixed(2) + 'B');
  console.log('  Resolved volume: $' + (volData[0].resolved_volume / 1e9).toFixed(2) + 'B');
  console.log('  Volume coverage:', volData[0].volume_coverage_pct + '%');
  console.log();

  await client.close();
}

main().catch(console.error);
