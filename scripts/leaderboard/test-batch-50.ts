import { config } from 'dotenv';
config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { clickhouse } from '../../lib/clickhouse/client';
import { computeCCRv1 } from '../../lib/pnl/ccrEngineV1';

const MIN_RESOLVED = 10;

async function main() {
  // Load pool
  const poolPath = path.join(__dirname, 'final-candidates.json');
  const pool = JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
  const wallets = pool.wallets.slice(0, 50).map((w: any) => w.wallet.toLowerCase());

  console.log('Testing with ' + wallets.length + ' wallets');

  let processed = 0;
  let errors = 0;

  for (const wallet of wallets) {
    try {
      const metrics = await computeCCRv1(wallet);

      const phantomTokens = metrics.external_sell_tokens;
      const isPhantom = phantomTokens > 10 || metrics.external_sell_ratio > 0.05;
      const isCopyable = metrics.edge_ratio > 1.0 && !isPhantom &&
                         metrics.resolved_count >= MIN_RESOLVED && metrics.win_rate >= 0.4;

      const row = {
        wallet_address: wallet,
        realized_pnl: metrics.realized_pnl,
        total_pnl: metrics.total_pnl,
        volume_usd: metrics.volume_traded,
        total_trades: metrics.total_trades,
        positions_count: metrics.positions_count,
        resolved_positions: metrics.resolved_count,
        unresolved_positions: metrics.unresolved_count,
        win_count: metrics.win_count,
        loss_count: metrics.loss_count,
        win_rate: metrics.win_rate,
        avg_win_pct: metrics.avg_win_pct,
        avg_loss_pct: metrics.avg_loss_pct,
        breakeven_wr: metrics.breakeven_wr,
        edge_ratio: metrics.edge_ratio,
        is_phantom: isPhantom ? 1 : 0,
        phantom_tokens: phantomTokens,
        is_copyable: isCopyable ? 1 : 0,
        pnl_confidence: metrics.pnl_confidence,
        external_sell_ratio: metrics.external_sell_ratio,
        first_trade: '1970-01-01 00:00:00',
        last_trade: '1970-01-01 00:00:00',
        days_active: 0
      };

      await clickhouse.insert({
        table: 'pm_copy_trading_metrics_v1',
        values: [row],
        format: 'JSONEachRow',
      });

      processed++;
      if (processed % 10 === 0) {
        console.log('Processed: ' + processed);
      }
    } catch (error: any) {
      console.error('Error on ' + wallet + ': ' + error.message);
      errors++;
    }
  }

  console.log('Done! Processed: ' + processed + ', Errors: ' + errors);

  const q = 'SELECT count() as cnt FROM pm_copy_trading_metrics_v1 FINAL';
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];
  console.log('Total rows: ' + rows[0]?.cnt);
}

main().catch(console.error);
