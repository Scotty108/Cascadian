/**
 * Compare CLOB PnL vs Archive PnL per token for W1
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
  console.log('=== CLOB PNL vs ARCHIVE PNL COMPARISON ===');
  console.log('');

  // Get archive positions with resolved condition_ids
  const archiveResult = await client.query({
    query: `
      WITH archive_raw AS (
        SELECT
          splitByString('.', condition_id)[1] as token_id,
          realized_pnl/1e6 as archive_pnl,
          total_bought/1e6 as total_bought,
          total_sold/1e6 as total_sold
        FROM pm_archive.pm_user_positions
        WHERE lower(proxy_wallet) = '${W1}' AND is_deleted = 0
      ),
      with_mapping AS (
        SELECT
          a.*,
          m.condition_id as real_condition_id,
          m.outcome_index
        FROM archive_raw a
        LEFT JOIN pm_token_to_condition_map_v3 m
          ON a.token_id = toString(m.token_id_dec)
      ),
      with_resolution AS (
        SELECT
          w.*,
          r.payout_numerators,
          CASE
            WHEN r.payout_numerators LIKE '[1,%' AND w.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[0,%' AND w.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[0,%' AND w.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[1,%' AND w.outcome_index = 1 THEN 0.0
            ELSE NULL
          END as resolution_price
        FROM with_mapping w
        LEFT JOIN pm_condition_resolutions r
          ON lower(w.real_condition_id) = lower(r.condition_id) AND r.is_deleted = 0
      )
      SELECT
        token_id,
        real_condition_id,
        outcome_index,
        archive_pnl,
        total_bought,
        total_sold,
        payout_numerators,
        resolution_price
      FROM with_resolution
      ORDER BY abs(archive_pnl) DESC
    `,
    format: 'JSONEachRow'
  });
  const archivePositions = await archiveResult.json() as any[];

  console.log('Top 10 archive positions by |PnL|:');
  console.log('');

  let totalArchivePnl = 0;
  let totalClobPnl = 0;

  for (const pos of archivePositions.slice(0, 10)) {
    totalArchivePnl += pos.archive_pnl || 0;

    // Calculate CLOB PnL for this token
    const clobResult = await client.query({
      query: `
        SELECT
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares,
          COUNT(*) as trades
        FROM (
          SELECT
            event_id,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc,
            any(token_amount)/1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${W1}'
            AND is_deleted = 0
            AND toString(token_id) = '${pos.token_id}'
          GROUP BY event_id
        )
      `,
      format: 'JSONEachRow'
    });
    const clob = (await clobResult.json() as any[])[0] || { cash_flow: 0, final_shares: 0, trades: 0 };

    // Calculate CLOB PnL
    const resolutionPrice = pos.resolution_price !== null ? pos.resolution_price : 0;
    const clobPnl = (clob.cash_flow || 0) + ((clob.final_shares || 0) * resolutionPrice);
    totalClobPnl += clobPnl;

    console.log(`Token: ${(pos.real_condition_id || 'unknown').substring(0, 12)}... outcome_${pos.outcome_index}`);
    console.log(`  Archive: pnl=$${(pos.archive_pnl || 0).toFixed(2)} | bought=$${(pos.total_bought || 0).toFixed(2)} | sold=$${(pos.total_sold || 0).toFixed(2)}`);
    console.log(`  CLOB:    pnl=$${clobPnl.toFixed(2)} | cash_flow=$${(clob.cash_flow || 0).toFixed(2)} | shares=${(clob.final_shares || 0).toFixed(2)} | trades=${clob.trades || 0}`);
    console.log(`  Resolution: ${pos.payout_numerators || 'unresolved'} -> price=${resolutionPrice}`);
    console.log(`  Diff: $${(clobPnl - (pos.archive_pnl || 0)).toFixed(2)}`);
    console.log('');
  }

  // Calculate for all positions
  console.log('=== CALCULATING ALL POSITIONS ===');
  let fullArchivePnl = 0;
  let fullClobPnl = 0;

  for (const pos of archivePositions) {
    fullArchivePnl += pos.archive_pnl || 0;

    const clobResult = await client.query({
      query: `
        SELECT
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM (
          SELECT
            event_id,
            any(side) as side,
            any(usdc_amount)/1e6 as usdc,
            any(token_amount)/1e6 as tokens
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${W1}'
            AND is_deleted = 0
            AND toString(token_id) = '${pos.token_id}'
          GROUP BY event_id
        )
      `,
      format: 'JSONEachRow'
    });
    const clob = (await clobResult.json() as any[])[0] || { cash_flow: 0, final_shares: 0 };

    const resolutionPrice = pos.resolution_price !== null ? pos.resolution_price : 0;
    const clobPnl = (clob.cash_flow || 0) + ((clob.final_shares || 0) * resolutionPrice);
    fullClobPnl += clobPnl;
  }

  console.log('');
  console.log('=== FULL COMPARISON ===');
  console.log(`Archive total: $${fullArchivePnl.toFixed(2)}`);
  console.log(`CLOB total: $${fullClobPnl.toFixed(2)}`);
  console.log(`Difference: $${(fullClobPnl - fullArchivePnl).toFixed(2)}`);
  console.log('');
  console.log('Known values:');
  console.log('  Archive: $-6,138.89');
  console.log('  API: $12,298.89');

  await client.close();
}

main().catch(console.error);
