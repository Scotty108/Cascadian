/**
 * Recompute Unmapped Tokens After V4 Patch
 *
 * Step 0 of the final unmapped token resolution plan.
 * Finds all tokens in pm_trader_events_v2 that are STILL not in pm_token_to_condition_map_v4
 *
 * Uses LEFT JOIN anti-pattern instead of NOT EXISTS (which fails on views in ClickHouse)
 */

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('='.repeat(100));
  console.log('STEP 0: RECOMPUTE UNMAPPED TOKENS AFTER V4 PATCH');
  console.log('='.repeat(100));
  console.log('');

  // First, show current state
  console.log('Current token mapping state:');

  const [v3Count, patchCount, v4Count] = await Promise.all([
    clickhouse.query({ query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v3', format: 'JSONEachRow' }),
    clickhouse.query({ query: 'SELECT count() as cnt FROM pm_token_to_condition_patch', format: 'JSONEachRow' }),
    clickhouse.query({ query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v4', format: 'JSONEachRow' }),
  ]);

  const v3Rows = (await v3Count.json()) as any[];
  const patchRows = (await patchCount.json()) as any[];
  const v4Rows = (await v4Count.json()) as any[];

  console.log(`  V3 map:    ${Number(v3Rows[0]?.cnt || 0).toLocaleString()} tokens`);
  console.log(`  Patch:     ${Number(patchRows[0]?.cnt || 0).toLocaleString()} tokens`);
  console.log(`  V4 total:  ${Number(v4Rows[0]?.cnt || 0).toLocaleString()} tokens`);
  console.log('');

  // Count total unique tokens in trader events
  console.log('Counting unique tokens in pm_trader_events_v2...');
  const totalTokensQuery = `
    SELECT uniqExact(token_id) as cnt
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND token_id != ''
  `;
  const totalResult = await clickhouse.query({ query: totalTokensQuery, format: 'JSONEachRow' });
  const totalRows = (await totalResult.json()) as any[];
  const totalTokens = Number(totalRows[0]?.cnt || 0);
  console.log(`  Total unique tokens in trader events: ${totalTokens.toLocaleString()}`);
  console.log('');

  // Find unmapped tokens using LEFT JOIN anti-pattern (avoids NOT EXISTS issue with views)
  console.log('Finding tokens STILL unmapped after v4 patch...');
  console.log('(Using LEFT JOIN anti-pattern to avoid ClickHouse view limitations)');
  console.log('');

  // Use a subquery to get unique v4 tokens first, then LEFT JOIN
  const unmappedQuery = `
    WITH
      v4_tokens AS (
        SELECT DISTINCT token_id_dec FROM pm_token_to_condition_map_v4
      ),
      trader_tokens AS (
        SELECT
          token_id,
          count() AS trade_count,
          sum(usdc_amount) / 1e6 AS total_usdc,
          uniqExact(trader_wallet) AS unique_wallets,
          min(trade_time) AS first_trade,
          max(trade_time) AS last_trade
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND token_id != ''
        GROUP BY token_id
      )
    SELECT
      t.token_id,
      t.trade_count,
      t.total_usdc,
      t.unique_wallets,
      t.first_trade,
      t.last_trade
    FROM trader_tokens t
    LEFT JOIN v4_tokens v ON t.token_id = v.token_id_dec
    WHERE v.token_id_dec IS NULL
    ORDER BY t.total_usdc DESC
  `;

  const startTime = Date.now();
  const unmappedResult = await clickhouse.query({ query: unmappedQuery, format: 'JSONEachRow' });
  const unmappedRows = (await unmappedResult.json()) as any[];
  const queryTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`Query completed in ${queryTime}s`);
  console.log('');

  // Calculate summary stats
  const unmappedCount = unmappedRows.length;
  const totalUsdc = unmappedRows.reduce((sum: number, r: any) => sum + Number(r.total_usdc), 0);
  const totalTrades = unmappedRows.reduce((sum: number, r: any) => sum + Number(r.trade_count), 0);
  const totalWallets = unmappedRows.reduce((sum: number, r: any) => sum + Number(r.unique_wallets), 0);

  console.log('='.repeat(100));
  console.log('UNMAPPED TOKEN SUMMARY (AFTER V4 PATCH)');
  console.log('='.repeat(100));
  console.log(`  Still unmapped:        ${unmappedCount.toLocaleString()} tokens`);
  console.log(`  Total USDC volume:     $${totalUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Total trades affected: ${totalTrades.toLocaleString()}`);
  console.log(`  Wallets affected:      ${totalWallets.toLocaleString()} (not unique)`);
  console.log('');

  // Coverage calculation
  const mappedCount = totalTokens - unmappedCount;
  const coveragePct = ((mappedCount / totalTokens) * 100).toFixed(2);
  console.log(`  Mapped tokens:         ${mappedCount.toLocaleString()} / ${totalTokens.toLocaleString()} (${coveragePct}%)`);
  console.log('');

  // Top 20 unmapped by USDC volume
  console.log('Top 20 unmapped tokens by USDC volume:');
  console.log('-'.repeat(100));
  console.log('Token ID (first 30 chars)                  | USDC Volume     | Trades   | Wallets | First Trade');
  console.log('-'.repeat(100));

  for (const t of unmappedRows.slice(0, 20)) {
    const tokenShort = t.token_id.substring(0, 30).padEnd(30);
    const usdc = ('$' + Number(t.total_usdc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).padStart(15);
    const trades = Number(t.trade_count).toLocaleString().padStart(8);
    const wallets = Number(t.unique_wallets).toLocaleString().padStart(7);
    const firstTrade = t.first_trade.substring(0, 10);
    console.log(`${tokenShort} | ${usdc} | ${trades} | ${wallets} | ${firstTrade}`);
  }
  console.log('');

  // Save to file for next steps
  const outputFile = 'data/unmapped-tokens-after-v4.json';

  // Ensure data directory exists
  if (!fs.existsSync('data')) {
    fs.mkdirSync('data', { recursive: true });
  }

  fs.writeFileSync(
    outputFile,
    JSON.stringify({
      generated_at: new Date().toISOString(),
      summary: {
        total_tokens_in_trader_events: totalTokens,
        mapped_tokens: mappedCount,
        unmapped_tokens: unmappedCount,
        coverage_pct: parseFloat(coveragePct),
        total_usdc_unmapped: totalUsdc,
        total_trades_unmapped: totalTrades,
      },
      v4_state: {
        v3_count: Number(v3Rows[0]?.cnt || 0),
        patch_count: Number(patchRows[0]?.cnt || 0),
        v4_total: Number(v4Rows[0]?.cnt || 0),
      },
      tokens: unmappedRows.map((r: any) => ({
        token_id: r.token_id,
        trade_count: Number(r.trade_count),
        total_usdc: Number(r.total_usdc),
        unique_wallets: Number(r.unique_wallets),
        first_trade: r.first_trade,
        last_trade: r.last_trade,
      })),
    }, null, 2)
  );

  console.log(`Full unmapped token list saved to: ${outputFile}`);
  console.log('');
  console.log('='.repeat(100));
  console.log('NEXT STEPS');
  console.log('='.repeat(100));
  console.log('Step 1: Check if any of these tokens can be derived from our own data');
  console.log('        (pm_ctf_events, pm_condition_resolutions, pm_market_metadata)');
  console.log('Step 2: Resolve remaining via Gamma API');
  console.log('Step 3: Rebuild pm_unified_ledger_v8');
  console.log('Step 4: Final benchmark and report');
  console.log('');
}

main().catch(console.error);
