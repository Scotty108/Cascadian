/**
 * Fast Priority Wallet PnL Computation
 *
 * Processes high-volume wallets first (most likely to have $500+ PnL).
 * Uses larger batches and can be run in parallel by specifying offset ranges.
 *
 * Usage:
 *   npx tsx scripts/pnl/fast-compute-priority-wallets.ts --minVolume=50000
 *   npx tsx scripts/pnl/fast-compute-priority-wallets.ts --minVolume=20000 --offset=0 --limit=20000
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import {
  emptyPosition,
  updateWithBuy,
  updateWithSell,
  Position,
} from '../../lib/pnl/costBasisEngineV1';
import { loadResolutionsStrict } from '../../lib/pnl/loadResolutionsStrict';

const BATCH_SIZE = 100; // Wallets per batch

async function main() {
  const args = process.argv.slice(2);
  const minVolumeArg = args.find((a) => a.startsWith('--minVolume='));
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const offsetArg = args.find((a) => a.startsWith('--offset='));

  const minVolume = minVolumeArg ? parseInt(minVolumeArg.split('=')[1]) : 50000;
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 100000;
  const offset = offsetArg ? parseInt(offsetArg.split('=')[1]) : 0;

  const client = getClickHouseClient();

  console.log(`=== PRIORITY WALLET PNL (minVolume=$${minVolume.toLocaleString()}) ===\n`);

  // Load resolutions
  console.log('Loading resolutions...');
  const { resolutions } = await loadResolutionsStrict();
  console.log(`Loaded ${resolutions.size.toLocaleString()} resolutions\n`);

  // Get priority wallets not yet in cache
  console.log('Getting priority wallets...');
  const walletResult = await client.query({
    query: `
      WITH cached AS (SELECT wallet FROM pm_wallet_engine_pnl_cache FINAL)
      SELECT wallet, taker_ratio, maker_count
      FROM pm_wallet_trade_stats FINAL
      WHERE last_trade_time >= now() - INTERVAL 30 DAY
        AND total_count >= 20
        AND maker_usdc >= ${minVolume}
        AND maker_count <= 50000
        AND wallet NOT IN (SELECT wallet FROM cached)
      ORDER BY maker_usdc DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    format: 'JSONEachRow',
  });

  const walletRows = (await walletResult.json()) as any[];
  const walletData = new Map<string, { takerRatio: number; makerCount: number }>();
  for (const row of walletRows) {
    walletData.set(row.wallet, {
      takerRatio: Number(row.taker_ratio),
      makerCount: Number(row.maker_count),
    });
  }
  const wallets = Array.from(walletData.keys());

  console.log(`Processing ${wallets.length.toLocaleString()} priority wallets\n`);

  if (wallets.length === 0) {
    console.log('No wallets to process!');
    return;
  }

  const startTime = Date.now();
  let processed = 0;
  let profitable = 0;
  let meetsCriteria = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);
    const walletList = batch.map((w) => `'${w}'`).join(',');

    try {
      // Load trades
      const tradeResult = await client.query({
        query: `
          WITH deduped AS (
            SELECT
              lower(trader_wallet) as wallet, event_id,
              any(token_id) as token_id, any(side) as side,
              any(token_amount) / 1000000.0 as token_amount,
              any(usdc_amount) / 1000000.0 as usdc_amount
            FROM pm_trader_events_v2
            WHERE lower(trader_wallet) IN (${walletList}) AND is_deleted = 0 AND role = 'maker'
            GROUP BY wallet, event_id
          )
          SELECT * FROM deduped ORDER BY wallet
        `,
        format: 'JSONEachRow',
      });

      const trades = (await tradeResult.json()) as any[];
      const tradesByWallet = new Map<string, any[]>();
      for (const w of batch) tradesByWallet.set(w, []);
      for (const t of trades) {
        const wt = tradesByWallet.get(t.wallet);
        if (wt) wt.push(t);
      }

      // Compute PnL for each wallet
      const results: any[] = [];
      for (const wallet of batch) {
        const wTrades = tradesByWallet.get(wallet) || [];
        const data = walletData.get(wallet)!;

        const positions = new Map<string, Position>();
        let externalSells = 0;
        let totalSells = 0;

        for (const t of wTrades) {
          let pos = positions.get(t.token_id) || emptyPosition(wallet, t.token_id);
          const price = Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;

          if (t.side === 'buy') {
            pos = updateWithBuy(pos, Number(t.token_amount), price);
          } else {
            totalSells += Number(t.usdc_amount);
            const { position: newPos, result } = updateWithSell(pos, Number(t.token_amount), price);
            pos = newPos;
            externalSells += result.externalSell;
          }
          positions.set(t.token_id, pos);
        }

        let realizedPnl = 0;
        let unrealizedPnl = 0;
        let winningPnl = 0;
        let losingPnl = 0;
        let unresolvedCost = 0;

        for (const [tokenId, pos] of positions) {
          realizedPnl += pos.realizedPnl;
          const payout = resolutions.get(tokenId);
          if (pos.amount > 0) {
            if (payout !== undefined) {
              unrealizedPnl += pos.amount * (payout - pos.avgPrice);
            } else {
              unresolvedCost += pos.amount * pos.avgPrice;
            }
          }
          const posPnl = pos.realizedPnl + (payout !== undefined && pos.amount > 0 ? pos.amount * (payout - pos.avgPrice) : 0);
          if (posPnl > 0) winningPnl += posPnl;
          else if (posPnl < 0) losingPnl += Math.abs(posPnl);
        }

        const enginePnl = realizedPnl + unrealizedPnl;
        const profitFactor = losingPnl > 0 ? winningPnl / losingPnl : winningPnl > 0 ? 999 : 1;
        const externalSellsRatio = totalSells > 0 ? externalSells / totalSells : 0;
        const openExposureRatio = unresolvedCost / Math.max(Math.abs(enginePnl), 1);

        results.push({
          wallet,
          engine_pnl: enginePnl,
          realized_pnl: realizedPnl,
          unrealized_pnl: unrealizedPnl,
          trade_count: wTrades.length,
          position_count: positions.size,
          external_sells: externalSells,
          profit_factor: profitFactor,
          external_sells_ratio: externalSellsRatio,
          open_exposure_ratio: openExposureRatio,
          taker_ratio: data.takerRatio,
        });

        processed++;
        if (enginePnl > 0) profitable++;
        if (enginePnl >= 500 && profitFactor >= 1 && wTrades.length >= 20) meetsCriteria++;
      }

      // Insert batch
      await client.insert({
        table: 'pm_wallet_engine_pnl_cache',
        values: results,
        format: 'JSONEachRow',
      });

      // Progress
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const pct = ((processed / wallets.length) * 100).toFixed(1);
      const eta = (wallets.length - processed) / rate;
      process.stdout.write(`\r${processed}/${wallets.length} (${pct}%) | ${rate.toFixed(0)}/s | ETA ${Math.round(eta)}s | Criteria: ${meetsCriteria}     `);

    } catch (e: any) {
      console.error(`\nBatch error: ${e.message}`);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\n=== COMPLETE ===`);
  console.log(`Processed: ${processed.toLocaleString()}`);
  console.log(`Profitable: ${profitable.toLocaleString()}`);
  console.log(`Meeting your criteria (≥20 trades, PnL≥$500, PF≥1): ${meetsCriteria.toLocaleString()}`);
  console.log(`Time: ${(elapsed / 60).toFixed(1)} min | Rate: ${(processed / elapsed).toFixed(0)}/s`);
}

main().catch(console.error);
