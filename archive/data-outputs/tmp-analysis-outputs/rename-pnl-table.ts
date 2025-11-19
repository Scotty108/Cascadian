#!/usr/bin/env npx tsx
import { clickhouse } from '../lib/clickhouse/client.js';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(process.cwd(), '.env.local') });

(async () => {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('RENAMING STAGING TABLE → PRODUCTION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Check if staging table exists
  const checkStaging = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM default.realized_pnl_by_market_final_staging',
    format: 'JSONEachRow'
  });
  const stagingCount = await checkStaging.json();
  console.log('✅ Staging table exists:', stagingCount[0].cnt.toLocaleString(), 'rows\n');

  // Rename staging to production (atomic operation)
  console.log('Executing atomic rename...');
  await clickhouse.command({
    query: 'RENAME TABLE default.realized_pnl_by_market_final_staging TO default.realized_pnl_by_market_final'
  });
  console.log('✅ Rename complete!\n');

  // Verify production table
  const checkProd = await clickhouse.query({
    query: 'SELECT COUNT(*) as cnt FROM default.realized_pnl_by_market_final',
    format: 'JSONEachRow'
  });
  const prodCount = await checkProd.json();
  console.log('✅ Production table verified:', prodCount[0].cnt.toLocaleString(), 'rows\n');

  // Get sign distribution
  const signDist = await clickhouse.query({
    query: `
      SELECT
        SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as positive,
        SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as negative,
        SUM(CASE WHEN realized_pnl_usd = 0 THEN 1 ELSE 0 END) as zero,
        SUM(realized_pnl_usd) as total_pnl
      FROM default.realized_pnl_by_market_final
    `,
    format: 'JSONEachRow'
  });
  const dist = await signDist.json();
  console.log('Sign Distribution:');
  console.log('  Positive:', dist[0].positive.toLocaleString(), '(' + ((dist[0].positive / prodCount[0].cnt) * 100).toFixed(1) + '%)');
  console.log('  Negative:', dist[0].negative.toLocaleString(), '(' + ((dist[0].negative / prodCount[0].cnt) * 100).toFixed(1) + '%)');
  console.log('  Zero:', dist[0].zero.toLocaleString(), '(' + ((dist[0].zero / prodCount[0].cnt) * 100).toFixed(1) + '%)');
  console.log('  Total P&L:', '$' + (dist[0].total_pnl / 1e9).toFixed(2) + 'B\n');

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('✅ PRODUCTION TABLE UPDATED WITH SIGN-CORRECTED P&L');
  console.log('═══════════════════════════════════════════════════════════════════');
})().catch(console.error);
