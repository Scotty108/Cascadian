#!/usr/bin/env npx tsx
/**
 * VALIDATION METRICS - NO RECOMMENDATIONS
 *
 * Runs 4 validation queries and reports metrics only.
 */

import { config } from 'dotenv';
import { clickhouse } from './lib/clickhouse/client.js';

config({ path: '.env.local' });

async function runValidations() {
  console.log('=== VALIDATION METRICS ===\n');

  // Query A: CID hygiene in vwc
  console.log('Query A: CID Hygiene in vw_trades_canonical');
  const queryA = `
WITH v AS (
  SELECT
    lpad(lower(replaceAll(coalesce(condition_id_norm, ''), '0x','')),64,'0') AS cid64
  FROM vw_trades_canonical
  WHERE condition_id_norm!=''
)
SELECT
  (SELECT count() FROM vw_trades_canonical) AS rows_total,
  (SELECT count() FROM v) AS rows_with_any_cid,
  (SELECT count() FROM v WHERE cid64 = repeat('0',64)) AS rows_all_zero,
  (SELECT count() FROM v WHERE match(cid64,'^[0-9a-f]{64}$')) AS rows_hex64,
  round(100.0 * rows_hex64 / nullIf(rows_with_any_cid,0),2) AS pct_hex64_of_with_any`;

  const resA = await clickhouse.query({ query: queryA, format: 'JSONEachRow' });
  const dataA = await resA.json();
  console.log(JSON.stringify(dataA[0], null, 2));
  const pct_hex64_of_with_any = dataA[0].pct_hex64_of_with_any;
  console.log();

  // Query B: Joinability of vwc CIDs to res
  console.log('Query B: Joinability to market_resolutions_final');
  const queryB = `
WITH
v AS (
  SELECT DISTINCT lpad(lower(replaceAll(condition_id_norm,'0x','')),64,'0') AS cid64
  FROM vw_trades_canonical
  WHERE condition_id_norm!=''
),
r AS (
  SELECT DISTINCT lpad(lower(replaceAll(coalesce(condition_id_norm, condition_id,''),'0x','')),64,'0') AS cid64
  FROM market_resolutions_final
  WHERE coalesce(condition_id_norm, condition_id)!=''
),
o AS (SELECT cid64 FROM v INNER JOIN r USING(cid64))
SELECT
  (SELECT count() FROM v)  AS v_cids,
  (SELECT count() FROM r)  AS r_cids,
  (SELECT count() FROM o)  AS overlap,
  round(100.0 * (SELECT count() FROM o) / nullIf((SELECT count() FROM r),0),2) AS pct_res_in_v,
  round(100.0 * (SELECT count() FROM o) / nullIf((SELECT count() FROM v),0),2) AS pct_v_in_res`;

  const resB = await clickhouse.query({ query: queryB, format: 'JSONEachRow' });
  const dataB = await resB.json();
  console.log(JSON.stringify(dataB[0], null, 2));
  const pct_res_in_v = dataB[0].pct_res_in_v;
  const pct_v_in_res = dataB[0].pct_v_in_res;
  console.log();

  // Query C: Wallet coverage vs resolved markets
  console.log('Query C: Wallet Coverage vs Resolved Markets');
  const queryC = `
WITH
v AS (
  SELECT
    lower(wallet_address_norm) AS wallet,
    lpad(lower(replaceAll(condition_id_norm,'0x','')),64,'0') AS cid64,
    toFloat64OrZero(usd_value) AS usd_value
  FROM vw_trades_canonical
  WHERE wallet_address_norm!='' AND condition_id_norm!=''
),
r AS (
  SELECT DISTINCT lpad(lower(replaceAll(coalesce(condition_id_norm, condition_id,''),'0x','')),64,'0') AS cid64
  FROM market_resolutions_final
  WHERE coalesce(condition_id_norm, condition_id)!=''
),
w AS (
  SELECT
    wallet,
    count() AS rows_total,
    sum(usd_value) AS vol_total,
    countIf(cid64 IN (SELECT cid64 FROM r)) AS rows_joinable,
    sumIf(usd_value, cid64 IN (SELECT cid64 FROM r)) AS vol_joinable
  FROM v
  GROUP BY wallet
),
agg AS (
  SELECT
    countIf(rows_joinable * 1.0 / rows_total >= 0.8) AS wallets_ge80,
    count() AS wallets_total,
    sum(vol_joinable) AS vol_joinable,
    sum(vol_total) AS vol_total
  FROM w
)
SELECT
  wallets_ge80, wallets_total,
  round(100.0 * wallets_ge80 / nullIf(wallets_total,0),2) AS pct_wallets_ge80,
  round(100.0 * vol_joinable / nullIf(vol_total,0),2)     AS pct_volume_joinable`;

  const resC = await clickhouse.query({ query: queryC, format: 'JSONEachRow' });
  const dataC = await resC.json();
  console.log(JSON.stringify(dataC[0], null, 2));
  const pct_wallets_ge80 = dataC[0].pct_wallets_ge80;
  const pct_volume_joinable = dataC[0].pct_volume_joinable;
  console.log();

  // Query D: Missing tx overlap
  console.log('Query D: Missing TX Overlap');
  const queryD = `
WITH
missing AS (
  SELECT DISTINCT lower(replaceRegexpOne(transaction_hash,'^.*?(0x[0-9a-fA-F]{64}).*?$','\\1')) AS tx66
  FROM trades_raw_enriched_final
  WHERE (condition_id='' OR condition_id IS NULL OR condition_id=concat('0x',repeat('0',64)))
        AND transaction_hash!=''
),
v AS (
  SELECT DISTINCT lower(replaceRegexpOne(transaction_hash,'^.*?(0x[0-9a-fA-F]{64}).*?$','\\1')) AS tx66
  FROM vw_trades_canonical
  WHERE transaction_hash!=''
),
ov AS (SELECT tx66 FROM missing INNER JOIN v USING(tx66))
SELECT
  (SELECT count() FROM missing) AS missing_txs,
  (SELECT count() FROM v) AS vwc_txs,
  (SELECT count() FROM ov) AS overlap,
  round(100.0 * (SELECT count() FROM ov) / nullIf((SELECT count() FROM missing),0),2) AS pct_in_vwc_missing_overlap`;

  const resD = await clickhouse.query({ query: queryD, format: 'JSONEachRow' });
  const dataD = await resD.json();
  console.log(JSON.stringify(dataD[0], null, 2));
  const pct_in_vwc_missing_overlap = dataD[0].pct_in_vwc_missing_overlap;
  console.log();

  // Summary
  console.log('=== KEY METRICS ===');
  console.log(`pct_hex64_of_with_any: ${pct_hex64_of_with_any}%`);
  console.log(`pct_res_in_v: ${pct_res_in_v}%`);
  console.log(`pct_v_in_res: ${pct_v_in_res}%`);
  console.log(`pct_wallets_ge80: ${pct_wallets_ge80}%`);
  console.log(`pct_volume_joinable: ${pct_volume_joinable}%`);
  console.log(`pct_in_vwc_missing_overlap: ${pct_in_vwc_missing_overlap}%`);
  console.log();

  // Conditional samples
  if (pct_hex64_of_with_any < 98) {
    console.log('=== SAMPLE: Bad CIDs (pct_hex64_of_with_any < 98) ===');
    const sampleBadCids = `
SELECT
  condition_id_norm,
  lpad(lower(replaceAll(condition_id_norm, '0x','')),64,'0') AS cid64,
  length(replaceAll(condition_id_norm, '0x','')) AS len,
  match(lpad(lower(replaceAll(condition_id_norm, '0x','')),64,'0'), '^[0-9a-f]{64}$') AS is_hex64
FROM vw_trades_canonical
WHERE condition_id_norm!=''
  AND NOT match(lpad(lower(replaceAll(condition_id_norm, '0x','')),64,'0'), '^[0-9a-f]{64}$')
LIMIT 100`;

    const resSample1 = await clickhouse.query({ query: sampleBadCids, format: 'JSONEachRow' });
    const dataSample1 = await resSample1.json();
    console.log(JSON.stringify(dataSample1.slice(0, 10), null, 2));
    console.log(`... (${dataSample1.length} total bad CIDs sampled)`);
    console.log();
  }

  if (pct_res_in_v < 90) {
    console.log('=== SAMPLE: CIDs in vwc but not in res (pct_res_in_v < 90) ===');
    const sampleNotInRes = `
WITH
v AS (
  SELECT DISTINCT
    lpad(lower(replaceAll(condition_id_norm,'0x','')),64,'0') AS cid64
  FROM vw_trades_canonical
  WHERE condition_id_norm!=''
),
r AS (
  SELECT DISTINCT
    lpad(lower(replaceAll(coalesce(condition_id_norm, condition_id,''),'0x','')),64,'0') AS cid64
  FROM market_resolutions_final
  WHERE coalesce(condition_id_norm, condition_id)!=''
),
not_in_res AS (
  SELECT cid64 FROM v WHERE cid64 NOT IN (SELECT cid64 FROM r)
)
SELECT
  n.cid64,
  any(vw.market_id_norm) AS market_id,
  count() AS trade_count
FROM not_in_res n
LEFT JOIN vw_trades_canonical vw ON lpad(lower(replaceAll(vw.condition_id_norm,'0x','')),64,'0') = n.cid64
GROUP BY n.cid64
LIMIT 100`;

    const resSample2 = await clickhouse.query({ query: sampleNotInRes, format: 'JSONEachRow' });
    const dataSample2 = await resSample2.json();
    console.log(JSON.stringify(dataSample2.slice(0, 10), null, 2));
    console.log(`... (${dataSample2.length} total CIDs in vwc but not in res)`);
    console.log();
  }
}

runValidations().catch(console.error);
