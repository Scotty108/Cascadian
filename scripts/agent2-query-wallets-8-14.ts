import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { getClickHouseClient } from '../lib/clickhouse/client';
import { writeFileSync, mkdirSync } from 'fs';

const ch = getClickHouseClient();

const WALLETS = [
  '0xd06f0f7719df1b3b75b607923536b3250825d4a6',
  '0x3b6fd06a595d71c70afb3f44414be1c11304340b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x662244931c392df70bd064fa91f838eea0bfd7a9',
  '0x2e0b70d482e6b389e81dea528be57d825dd48070',
];

async function queryWallets() {
  const results = [];

  for (const wallet of WALLETS) {
    console.log(`Querying wallet: ${wallet}`);

    try {
      // Query vw_trades_canonical
      const vwQ = await ch.query({
        query: `SELECT count() as cnt FROM default.vw_trades_canonical WHERE lower(wallet_address_norm) = lower('${wallet}')`
      });
      const vw = await vwQ.json();

      // Query fact_trades_clean
      const factQ = await ch.query({
        query: `SELECT count() as cnt FROM cascadian_clean.fact_trades_clean WHERE lower(wallet_address) = lower('${wallet}')`
      });
      const fact = await factQ.json();

      // Query wallet_metrics
      const metricsQ = await ch.query({
        query: `SELECT realized_pnl, gross_gains_usd, gross_losses_usd FROM default.wallet_metrics WHERE lower(wallet_address) = lower('${wallet}') AND time_window = 'lifetime' LIMIT 1`
      });
      const metrics = await metricsQ.json();

      results.push({
        wallet,
        vw_trades: vw.data[0]?.cnt || 0,
        fact_trades: fact.data[0]?.cnt || 0,
        realized_pnl: metrics.data[0]?.realized_pnl || null,
        gross_gains_usd: metrics.data[0]?.gross_gains_usd || null,
        gross_losses_usd: metrics.data[0]?.gross_losses_usd || null,
      });

      console.log(`  ✓ vw_trades: ${vw.data[0]?.cnt || 0}, fact_trades: ${fact.data[0]?.cnt || 0}, realized_pnl: ${metrics.data[0]?.realized_pnl || null}`);
    } catch (error) {
      console.error(`  ✗ Error querying ${wallet}:`, error);
      results.push({
        wallet,
        error: String(error),
        vw_trades: null,
        fact_trades: null,
        realized_pnl: null,
      });
    }
  }

  // Ensure tmp directory exists
  try {
    mkdirSync('tmp', { recursive: true });
  } catch (e) {
    // Directory may already exist
  }

  writeFileSync('tmp/agent2-results.json', JSON.stringify(results, null, 2));
  console.log('\n✅ Agent 2 complete - saved to tmp/agent2-results.json');
  console.log(JSON.stringify(results, null, 2));
}

queryWallets().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
