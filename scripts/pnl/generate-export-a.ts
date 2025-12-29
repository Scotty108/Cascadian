/**
 * Generate Export A CSV
 *
 * Criteria:
 * - realized_pnl >= $500
 * - profit_factor >= 1
 * - 20+ trades
 * - Active in last 30 days
 *
 * Includes unrealized_share for user filtering
 */

import '@dotenvx/dotenvx/config';
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const client = createClient({ url: process.env.CLICKHOUSE_URL });

async function main() {
  console.log('=== GENERATING EXPORT A ===\n');

  // Query wallets meeting Export A criteria
  const result = await client.query({
    query: `
      SELECT
        c.wallet,
        c.realized_pnl,
        c.unrealized_pnl,
        c.engine_pnl,
        c.profit_factor,
        c.external_sells_ratio,
        s.taker_ratio,
        s.total_count as trade_count,
        s.total_usdc as volume_usdc,
        s.last_trade_time,
        -- Compute unrealized_share
        abs(c.unrealized_pnl) / greatest(abs(c.engine_pnl), 1) as unrealized_share,
        -- Confidence tier
        CASE
          WHEN abs(c.unrealized_pnl) / greatest(abs(c.engine_pnl), 1) < 0.1 AND s.taker_ratio < 0.05 THEN 'HIGH'
          WHEN abs(c.unrealized_pnl) / greatest(abs(c.engine_pnl), 1) < 0.3 AND s.taker_ratio < 0.10 THEN 'MEDIUM'
          WHEN abs(c.unrealized_pnl) / greatest(abs(c.engine_pnl), 1) < 0.5 THEN 'LOW'
          ELSE 'DISCOVERY'
        END as confidence_tier
      FROM pm_wallet_engine_pnl_cache c FINAL
      INNER JOIN pm_wallet_trade_stats s FINAL ON c.wallet = s.wallet
      WHERE s.last_trade_time >= now() - INTERVAL 30 DAY
        AND s.total_count >= 20
        AND c.realized_pnl >= 500
        AND c.profit_factor >= 1
      ORDER BY c.realized_pnl DESC
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as Array<{
    wallet: string;
    realized_pnl: number;
    unrealized_pnl: number;
    engine_pnl: number;
    profit_factor: number;
    external_sells_ratio: number;
    taker_ratio: number;
    trade_count: number;
    volume_usdc: number;
    last_trade_time: string;
    unrealized_share: number;
    confidence_tier: string;
  }>;

  console.log(`Found ${rows.length} wallets meeting Export A criteria\n`);

  // Generate CSV
  const headers = [
    'wallet',
    'realized_pnl',
    'unrealized_pnl',
    'engine_pnl',
    'profit_factor',
    'external_sells_ratio',
    'taker_ratio',
    'trade_count',
    'volume_usdc',
    'last_trade_time',
    'unrealized_share',
    'confidence_tier'
  ];

  const csvLines = [headers.join(',')];

  for (const row of rows) {
    csvLines.push([
      row.wallet,
      row.realized_pnl.toFixed(2),
      row.unrealized_pnl.toFixed(2),
      row.engine_pnl.toFixed(2),
      row.profit_factor.toFixed(4),
      row.external_sells_ratio.toFixed(4),
      row.taker_ratio.toFixed(4),
      row.trade_count,
      row.volume_usdc.toFixed(2),
      row.last_trade_time,
      row.unrealized_share.toFixed(4),
      row.confidence_tier
    ].join(','));
  }

  const outputPath = 'tmp/export_a_realized_pnl_gte500.csv';
  fs.writeFileSync(outputPath, csvLines.join('\n'));
  console.log(`CSV written to ${outputPath}`);

  // Summary by confidence tier
  console.log('\n=== SUMMARY BY CONFIDENCE TIER ===');
  const tierCounts: Record<string, number> = {};
  for (const row of rows) {
    tierCounts[row.confidence_tier] = (tierCounts[row.confidence_tier] || 0) + 1;
  }
  for (const [tier, count] of Object.entries(tierCounts).sort()) {
    console.log(`${tier}: ${count} wallets`);
  }

  // Top 10 by realized_pnl
  console.log('\n=== TOP 10 BY REALIZED PnL ===');
  console.log('Wallet | Realized | Profit Factor | Taker% | Confidence');
  for (const row of rows.slice(0, 10)) {
    console.log(
      `${row.wallet.slice(0, 10)}... | $${row.realized_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })} | ${row.profit_factor.toFixed(2)} | ${(row.taker_ratio * 100).toFixed(1)}% | ${row.confidence_tier}`
    );
  }

  await client.close();
}

main().catch(console.error);
