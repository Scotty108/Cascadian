/**
 * Compare CLOB vs Archive market coverage for W1
 *
 * Goal: Understand why archive PnL differs from CLOB-calculated PnL
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 120000
});

const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';

async function main() {
  console.log('=== COMPARING CLOB vs ARCHIVE MARKETS FOR W1 ===');
  console.log('');

  // 1. Get all condition_ids from CLOB for W1
  console.log('1. Getting CLOB markets for W1...');
  const clobResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${W1}' AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT DISTINCT
        lower(m.condition_id) as condition_id
      FROM deduped d
      JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
    `,
    format: 'JSONEachRow'
  });
  const clobMarkets = new Set((await clobResult.json() as any[]).map(r => r.condition_id));
  console.log('   CLOB markets:', clobMarkets.size);

  // 2. Get all condition_ids from archive for W1
  console.log('2. Getting archive markets for W1...');
  const archiveResult = await client.query({
    query: `
      SELECT DISTINCT lower(condition_id) as condition_id
      FROM pm_archive.pm_user_positions
      WHERE lower(proxy_wallet) = '${W1}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const archiveMarkets = new Set((await archiveResult.json() as any[]).map(r => r.condition_id));
  console.log('   Archive markets:', archiveMarkets.size);

  // 3. Find markets only in CLOB (missing from archive)
  const onlyInClob = [...clobMarkets].filter(x => !archiveMarkets.has(x));
  console.log('');
  console.log('3. Markets in CLOB but NOT in archive:', onlyInClob.length);

  // 4. Find markets only in archive (missing from CLOB)
  const onlyInArchive = [...archiveMarkets].filter(x => !clobMarkets.has(x));
  console.log('4. Markets in archive but NOT in CLOB:', onlyInArchive.length);

  // 5. Show the missing CLOB markets with resolution status
  if (onlyInClob.length > 0) {
    console.log('');
    console.log('=== CLOB-ONLY MARKETS (NOT IN ARCHIVE) ===');

    for (const cid of onlyInClob.slice(0, 10)) {
      // Check resolution status
      const resResult = await client.query({
        query: `
          SELECT payout_numerators, resolution_time
          FROM pm_condition_resolutions
          WHERE lower(condition_id) = '${cid}' AND is_deleted = 0
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });
      const resList = await resResult.json() as any[];
      const resolution = resList[0] || null;

      // Get trade summary
      const tradeResult = await client.query({
        query: `
          WITH deduped AS (
            SELECT
              event_id,
              any(token_id) as token_id,
              any(side) as side,
              any(usdc_amount)/1e6 as usdc,
              any(token_amount)/1e6 as tokens
            FROM pm_trader_events_v2
            WHERE trader_wallet = '${W1}' AND is_deleted = 0
            GROUP BY event_id
          )
          SELECT
            SUM(CASE WHEN side = 'buy' THEN usdc ELSE -usdc END) as net_cost,
            SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens
          FROM deduped d
          JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
          WHERE lower(m.condition_id) = '${cid}'
        `,
        format: 'JSONEachRow'
      });
      const trade = (await tradeResult.json() as any[])[0];

      console.log(`  ${cid.substring(0, 12)}... | ${resolution ? 'RESOLVED' : 'UNRESOLVED'} | net_cost: $${(trade?.net_cost || 0).toFixed(2)} | net_tokens: ${(trade?.net_tokens || 0).toFixed(2)}`);
    }
  }

  // 6. Show archive-only markets
  if (onlyInArchive.length > 0) {
    console.log('');
    console.log('=== ARCHIVE-ONLY MARKETS (NOT IN CLOB) ===');

    for (const cid of onlyInArchive.slice(0, 5)) {
      const archivePnlResult = await client.query({
        query: `
          SELECT
            outcome,
            realized_pnl/1e6 as pnl,
            size/1e6 as size
          FROM pm_archive.pm_user_positions
          WHERE lower(proxy_wallet) = '${W1}' AND lower(condition_id) = '${cid}' AND is_deleted = 0
        `,
        format: 'JSONEachRow'
      });
      const positions = await archivePnlResult.json() as any[];
      console.log(`  ${cid.substring(0, 12)}...`);
      for (const p of positions) {
        console.log(`    ${p.outcome}: size=${p.size.toFixed(2)}, pnl=$${p.pnl.toFixed(2)}`);
      }
    }
  }

  // 7. Compare PnL for overlapping markets
  console.log('');
  console.log('=== PNL COMPARISON FOR OVERLAPPING MARKETS ===');

  const overlapMarkets = [...clobMarkets].filter(x => archiveMarkets.has(x));
  console.log('Overlap markets:', overlapMarkets.length);

  let totalClobPnl = 0;
  let totalArchivePnl = 0;

  for (const cid of overlapMarkets) {
    // Archive PnL
    const archivePnlResult = await client.query({
      query: `
        SELECT SUM(realized_pnl)/1e6 as pnl
        FROM pm_archive.pm_user_positions
        WHERE lower(proxy_wallet) = '${W1}' AND lower(condition_id) = '${cid}' AND is_deleted = 0
      `,
      format: 'JSONEachRow'
    });
    const archivePnl = ((await archivePnlResult.json() as any[])[0]?.pnl || 0);
    totalArchivePnl += archivePnl;

    // CLOB-based calculation (market-level)
    const clobPnlResult = await client.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc,
            any(token_amount)/1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${W1}' AND is_deleted = 0
          GROUP BY event_id
        ),
        with_map AS (
          SELECT d.*, m.condition_id, m.outcome_index
          FROM deduped d
          JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
          WHERE lower(m.condition_id) = '${cid}'
        ),
        by_outcome AS (
          SELECT
            outcome_index,
            SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
            SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
          FROM with_map
          GROUP BY outcome_index
        ),
        with_res AS (
          SELECT
            b.*,
            r.payout_numerators,
            CASE
              WHEN r.payout_numerators LIKE '[1,%' AND b.outcome_index = 0 THEN 1.0
              WHEN r.payout_numerators LIKE '[0,%' AND b.outcome_index = 1 THEN 1.0
              ELSE 0.0
            END as resolution_price
          FROM by_outcome b
          LEFT JOIN pm_condition_resolutions r ON lower(r.condition_id) = '${cid}' AND r.is_deleted = 0
        )
        SELECT
          SUM(cash_flow + final_shares * resolution_price) as pnl
        FROM with_res
      `,
      format: 'JSONEachRow'
    });
    const clobPnl = ((await clobPnlResult.json() as any[])[0]?.pnl || 0);
    totalClobPnl += clobPnl;

    // Only print if there's a significant difference
    const diff = clobPnl - archivePnl;
    if (Math.abs(diff) > 10) {
      console.log(`  ${cid.substring(0, 12)}... | Archive: $${archivePnl.toFixed(2)} | CLOB: $${clobPnl.toFixed(2)} | Diff: $${diff.toFixed(2)}`);
    }
  }

  // 8. Calculate PnL for CLOB-only markets
  console.log('');
  console.log('=== PNL FOR CLOB-ONLY MARKETS ===');

  let clobOnlyPnl = 0;
  for (const cid of onlyInClob) {
    const clobPnlResult = await client.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc,
            any(token_amount)/1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${W1}' AND is_deleted = 0
          GROUP BY event_id
        ),
        with_map AS (
          SELECT d.*, m.condition_id, m.outcome_index
          FROM deduped d
          JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
          WHERE lower(m.condition_id) = '${cid}'
        ),
        by_outcome AS (
          SELECT
            outcome_index,
            SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
            SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
          FROM with_map
          GROUP BY outcome_index
        ),
        with_res AS (
          SELECT
            b.*,
            r.payout_numerators,
            CASE
              WHEN r.payout_numerators LIKE '[1,%' AND b.outcome_index = 0 THEN 1.0
              WHEN r.payout_numerators LIKE '[0,%' AND b.outcome_index = 1 THEN 1.0
              ELSE 0.0
            END as resolution_price
          FROM by_outcome b
          LEFT JOIN pm_condition_resolutions r ON lower(r.condition_id) = '${cid}' AND r.is_deleted = 0
        )
        SELECT
          SUM(cash_flow + final_shares * resolution_price) as pnl
        FROM with_res
      `,
      format: 'JSONEachRow'
    });
    const pnl = ((await clobPnlResult.json() as any[])[0]?.pnl || 0);
    clobOnlyPnl += pnl;

    if (Math.abs(pnl) > 100) {
      console.log(`  ${cid.substring(0, 12)}... | PnL: $${pnl.toFixed(2)}`);
    }
  }

  // 9. Calculate PnL for archive-only markets
  let archiveOnlyPnl = 0;
  for (const cid of onlyInArchive) {
    const archivePnlResult = await client.query({
      query: `
        SELECT SUM(realized_pnl)/1e6 as pnl
        FROM pm_archive.pm_user_positions
        WHERE lower(proxy_wallet) = '${W1}' AND lower(condition_id) = '${cid}' AND is_deleted = 0
      `,
      format: 'JSONEachRow'
    });
    const pnl = ((await archivePnlResult.json() as any[])[0]?.pnl || 0);
    archiveOnlyPnl += pnl;
  }

  console.log('');
  console.log('=== FINAL SUMMARY ===');
  console.log('');
  console.log('Market coverage:');
  console.log(`  CLOB markets: ${clobMarkets.size}`);
  console.log(`  Archive markets: ${archiveMarkets.size}`);
  console.log(`  CLOB-only: ${onlyInClob.length}`);
  console.log(`  Archive-only: ${onlyInArchive.length}`);
  console.log(`  Overlap: ${overlapMarkets.length}`);
  console.log('');
  console.log('PnL breakdown:');
  console.log(`  Overlap - Archive PnL: $${totalArchivePnl.toFixed(2)}`);
  console.log(`  Overlap - CLOB PnL: $${totalClobPnl.toFixed(2)}`);
  console.log(`  Overlap - Diff: $${(totalClobPnl - totalArchivePnl).toFixed(2)}`);
  console.log('');
  console.log(`  CLOB-only PnL: $${clobOnlyPnl.toFixed(2)}`);
  console.log(`  Archive-only PnL: $${archiveOnlyPnl.toFixed(2)}`);
  console.log('');
  console.log('Total estimates:');
  console.log(`  Archive Total: $${(totalArchivePnl + archiveOnlyPnl).toFixed(2)}`);
  console.log(`  CLOB Total: $${(totalClobPnl + clobOnlyPnl).toFixed(2)}`);
  console.log('');
  console.log('Known values:');
  console.log('  Archive: $-6,138.89');
  console.log('  API: $12,298.89');

  await client.close();
}

main().catch(console.error);
