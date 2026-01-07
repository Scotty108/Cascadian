import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

const wallet = '0xda5fff24aa9d889d6366da205029c73093102e9b';

async function check() {
  // Check trade distribution by month
  const monthQ = `
    SELECT
      toYYYYMM(trade_time) as month,
      'v2' as source,
      count() as cnt,
      sum(toFloat64(usdc_amount)) / 1e6 as usdc
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
    GROUP BY month
    UNION ALL
    SELECT
      toYYYYMM(trade_time) as month,
      'dedup_v2' as source,
      count() as cnt,
      sum(toFloat64(usdc_amount)) / 1e6 as usdc
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
    GROUP BY month
    ORDER BY month, source
  `;

  const monthData = await clickhouse.query({ query: monthQ, format: 'JSONEachRow' });
  const months = (await monthData.json()) as any[];

  console.log('=== TRADES BY MONTH ===');
  console.log('Month  | Source   | Trades | USDC Volume');
  console.log('-'.repeat(50));

  for (const m of months) {
    console.log(`${m.month} | ${String(m.source).padEnd(8)} | ${String(m.cnt).padStart(6)} | $${Number(m.usdc).toFixed(2)}`);
  }

  // Check table schemas
  console.log('\n=== TABLE COMPARISON ===');

  const v2CountQ = `SELECT count() as cnt FROM pm_trader_events_v2 WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0`;
  const dedupCountQ = `SELECT count() as cnt FROM pm_trader_events_dedup_v2_tbl WHERE lower(trader_wallet) = lower('${wallet}')`;

  const v2Count = await clickhouse.query({ query: v2CountQ, format: 'JSONEachRow' });
  const dedupCount = await clickhouse.query({ query: dedupCountQ, format: 'JSONEachRow' });

  const v2Data = (await v2Count.json()) as any[];
  const dedupData = (await dedupCount.json()) as any[];

  console.log(`V2 raw rows: ${v2Data[0]?.cnt}`);
  console.log(`DEDUP_V2 rows: ${dedupData[0]?.cnt}`);

  // The key question: why is the USDC volume different?
  const v2VolumeQ = `
    SELECT
      sum(toFloat64(usdc_amount)) / 1e6 as total_usdc,
      countDistinct(event_id) as unique_events
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
  `;

  const dedupVolumeQ = `
    SELECT
      sum(toFloat64(usdc_amount)) / 1e6 as total_usdc,
      countDistinct(event_id) as unique_events
    FROM pm_trader_events_dedup_v2_tbl
    WHERE lower(trader_wallet) = lower('${wallet}')
  `;

  const v2Vol = await clickhouse.query({ query: v2VolumeQ, format: 'JSONEachRow' });
  const dedupVol = await clickhouse.query({ query: dedupVolumeQ, format: 'JSONEachRow' });

  const v2VolData = (await v2Vol.json()) as any[];
  const dedupVolData = (await dedupVol.json()) as any[];

  console.log(`\nV2 total USDC: $${Number(v2VolData[0]?.total_usdc).toFixed(2)}, unique events: ${v2VolData[0]?.unique_events}`);
  console.log(`DEDUP_V2 total USDC: $${Number(dedupVolData[0]?.total_usdc).toFixed(2)}, unique events: ${dedupVolData[0]?.unique_events}`);

  // Find the actual difference - what event_ids are in V2 but not in DEDUP_V2?
  const diffQ = `
    SELECT
      v2.event_id,
      v2.usdc,
      v2.side
    FROM (
      SELECT event_id, any(usdc_amount) / 1e6 as usdc, any(side) as side
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
      GROUP BY event_id
    ) v2
    LEFT ANTI JOIN (
      SELECT event_id
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${wallet}')
      GROUP BY event_id
    ) d ON v2.event_id = d.event_id
    ORDER BY v2.usdc DESC
    LIMIT 20
  `;

  const diff = await clickhouse.query({ query: diffQ, format: 'JSONEachRow' });
  const diffData = (await diff.json()) as any[];

  console.log(`\n=== EVENT_IDs IN V2 BUT NOT IN DEDUP_V2 (top 20) ===`);
  if (diffData.length === 0) {
    console.log('None found - all V2 event_ids exist in DEDUP_V2');

    // So the difference must be in the AGGREGATION, not missing rows
    // Let's check if DEDUP_V2 has different usdc_amount values
    console.log('\n=== CHECKING USDC AMOUNT DIFFERENCES ===');

    const amountDiffQ = `
      SELECT
        v2.event_id,
        v2.usdc as v2_usdc,
        d.usdc as dedup_usdc,
        v2.usdc - d.usdc as diff
      FROM (
        SELECT event_id, any(usdc_amount) / 1e6 as usdc
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      ) v2
      INNER JOIN (
        SELECT event_id, any(usdc_amount) / 1e6 as usdc
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      ) d ON v2.event_id = d.event_id
      WHERE abs(v2.usdc - d.usdc) > 0.01
      ORDER BY abs(v2.usdc - d.usdc) DESC
      LIMIT 10
    `;

    const amountDiff = await clickhouse.query({ query: amountDiffQ, format: 'JSONEachRow' });
    const amountDiffData = (await amountDiff.json()) as any[];

    console.log(`Found ${amountDiffData.length} events with different USDC amounts`);
    for (const a of amountDiffData) {
      console.log(`  ${a.event_id.slice(0,30)}... | V2: $${Number(a.v2_usdc).toFixed(2)} | DEDUP: $${Number(a.dedup_usdc).toFixed(2)} | Diff: $${Number(a.diff).toFixed(2)}`);
    }
  } else {
    for (const d of diffData) {
      console.log(`  ${d.side} | $${Number(d.usdc).toFixed(2)} | ${d.event_id.slice(0,40)}...`);
    }
  }
}

check().catch(console.error);
