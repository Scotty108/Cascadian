/**
 * Analyze archive vs CLOB coverage for W1
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
  console.log('=== ARCHIVE vs CLOB COVERAGE ANALYSIS ===');
  console.log('');

  // For each archive position, compare total_bought with CLOB buy volume
  const result = await client.query({
    query: `
      WITH archive_data AS (
        SELECT
          splitByString('.', condition_id)[1] as token_id,
          realized_pnl/1e6 as archive_pnl,
          total_bought/1e6 as archive_bought,
          total_sold/1e6 as archive_sold
        FROM pm_archive.pm_user_positions
        WHERE lower(proxy_wallet) = '${W1}' AND is_deleted = 0
      ),
      clob_data AS (
        SELECT
          toString(token_id) as token_id,
          SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as clob_bought,
          SUM(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as clob_sold
        FROM (
          SELECT
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${W1}' AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      SELECT
        a.token_id,
        a.archive_pnl,
        a.archive_bought,
        a.archive_sold,
        c.clob_bought,
        c.clob_sold,
        a.archive_bought - coalesce(c.clob_bought, 0) as bought_diff,
        a.archive_sold - coalesce(c.clob_sold, 0) as sold_diff
      FROM archive_data a
      LEFT JOIN clob_data c ON a.token_id = c.token_id
      ORDER BY abs(a.archive_pnl) DESC
    `,
    format: 'JSONEachRow'
  });

  const positions = await result.json() as any[];

  console.log('Token                 | Archive PnL | Arc Bought | CLOB Bought | Diff');
  console.log('-'.repeat(85));

  let archiveOnlyCount = 0;
  let bothCount = 0;
  let archiveTotal = 0;
  let clobMatchTotal = 0;

  for (const p of positions) {
    const hasClob = p.clob_bought != null && p.clob_bought > 0;
    const hasArchive = p.archive_bought > 0;

    if (hasClob) bothCount++;
    else archiveOnlyCount++;

    archiveTotal += p.archive_pnl || 0;
    if (hasClob) {
      // For positions with CLOB data, calculate what CLOB-based PnL would be
      const netClobCash = (p.clob_sold || 0) - (p.clob_bought || 0);
      clobMatchTotal += p.archive_pnl || 0;
    }

    const notes = hasClob ? '' : 'ARCHIVE-ONLY';

    console.log(
      (p.token_id || '').substring(0, 20).padEnd(21) + ' | ' +
      ('$' + (p.archive_pnl || 0).toFixed(0)).padStart(11) + ' | ' +
      ('$' + (p.archive_bought || 0).toFixed(0)).padStart(10) + ' | ' +
      ('$' + (p.clob_bought || 0).toFixed(0)).padStart(11) + ' | ' +
      ('$' + (p.bought_diff || 0).toFixed(0)).padStart(8) + ' ' + notes
    );
  }

  console.log('');
  console.log('Summary:');
  console.log('  Positions with CLOB data:', bothCount);
  console.log('  Archive-only positions:', archiveOnlyCount);
  console.log('  Total archive PnL: $' + archiveTotal.toFixed(2));

  // Check if archive uses a different event source (like FPMM)
  console.log('');
  console.log('=== CHECKING FPMM DATA ===');

  const fpmmResult = await client.query({
    query: `
      SELECT COUNT(*) as count, SUM(amount_usdc)/1e6 as volume
      FROM pm_fpmm_trades
      WHERE lower(trader) = '${W1}'
    `,
    format: 'JSONEachRow'
  });
  const fpmm = (await fpmmResult.json() as any[])[0];
  console.log('FPMM trades for W1:', fpmm.count, '| Volume: $' + (fpmm.volume || 0).toFixed(2));

  // Check if there's any overlap in token_ids
  console.log('');
  console.log('=== FPMM TOKEN OVERLAP ===');
  const fpmmOverlapResult = await client.query({
    query: `
      WITH archive_tokens AS (
        SELECT DISTINCT splitByString('.', condition_id)[1] as token_id
        FROM pm_archive.pm_user_positions
        WHERE lower(proxy_wallet) = '${W1}' AND is_deleted = 0
      ),
      fpmm_tokens AS (
        SELECT DISTINCT toString(fpmm_pool_id) as token_id
        FROM pm_fpmm_trades
        WHERE lower(trader) = '${W1}'
      )
      SELECT
        (SELECT COUNT(*) FROM archive_tokens) as archive_count,
        (SELECT COUNT(*) FROM fpmm_tokens) as fpmm_count,
        (SELECT COUNT(*) FROM archive_tokens a JOIN fpmm_tokens f ON a.token_id = f.token_id) as overlap
    `,
    format: 'JSONEachRow'
  });
  const fpmmOverlap = (await fpmmOverlapResult.json() as any[])[0];
  console.log('Archive tokens:', fpmmOverlap.archive_count);
  console.log('FPMM tokens:', fpmmOverlap.fpmm_count);
  console.log('Overlap:', fpmmOverlap.overlap);

  await client.close();
}

main().catch(console.error);
