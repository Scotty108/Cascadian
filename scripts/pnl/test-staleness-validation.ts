/**
 * Test staleness validation with fresh vs legacy UI PnL values
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

const FRESH_VALUES = [
  { wallet: '0xa7cfafa0db244f760436fcf83c8b1eb98904ba10', legacyPnl: 11969.73, freshPnl: 16264.65 },
  { wallet: '0x7f3c8979d0afa00007bae4747d5347122af05613', legacyPnl: 179243, freshPnl: 214154.44 },
  { wallet: '0x3c3c46c1442ddbafce15a0097d2f5a0f4d797d32', legacyPnl: -3.45, freshPnl: -3.43 },
  { wallet: '0x8672768b9fadf29d8ad810ae2966d4e89e9ad2c1', legacyPnl: -4.98, freshPnl: -4.96 },
  { wallet: '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', legacyPnl: 114087, freshPnl: 130439.7 },
];

async function loadResolutions(client: any): Promise<Map<string, number>> {
  const result = await client.query({
    query: `
      SELECT m.token_id_dec as token_id,
        if(r.payout_numerators IS NULL, NULL,
           if(JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000, 1,
              JSONExtractInt(r.payout_numerators, m.outcome_index + 1))) as payout
      FROM pm_token_to_condition_map_v5 m
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.payout_numerators IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  const resolutions = new Map<string, number>();
  for (const r of rows) {
    if (r.payout !== null) resolutions.set(r.token_id, Number(r.payout));
  }
  return resolutions;
}

async function loadMakerTrades(client: any, wallet: string): Promise<any[]> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(token_id) as token_id, any(side) as side,
          any(token_amount) / 1000000.0 as token_amount,
          any(usdc_amount) / 1000000.0 as usdc_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0 AND role = 'maker'
        GROUP BY event_id
      ) SELECT * FROM deduped ORDER BY trade_time
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

function processWallet(
  trades: any[],
  resolutions: Map<string, number>
): { totalRealized: number; totalUnrealized: number; total: number } {
  const positions = new Map<string, Position>();

  for (const t of trades) {
    let pos = positions.get(t.token_id) || emptyPosition('', t.token_id);
    const price =
      Number(t.token_amount) > 0 ? Number(t.usdc_amount) / Number(t.token_amount) : 0;

    if (t.side === 'buy') {
      pos = updateWithBuy(pos, Number(t.token_amount), price);
    } else {
      const { position: newPos } = updateWithSell(pos, Number(t.token_amount), price);
      pos = newPos;
    }
    positions.set(t.token_id, pos);
  }

  let totalRealized = 0;
  let totalUnrealized = 0;

  for (const [tokenId, pos] of positions) {
    totalRealized += pos.realizedPnl;
    const payout = resolutions.get(tokenId);
    if (payout !== undefined && pos.amount > 0) {
      totalUnrealized += pos.amount * (payout - pos.avgPrice);
    }
  }

  return { totalRealized, totalUnrealized, total: totalRealized + totalUnrealized };
}

async function main() {
  const client = getClickHouseClient();
  console.log('Loading resolutions...');
  const resolutions = await loadResolutions(client);
  console.log(`Loaded ${resolutions.size} resolved tokens`);

  console.log('\n=== STALENESS VALIDATION TEST ===\n');
  console.log(
    '| Wallet | Legacy UI | Fresh UI | Engine | Legacy Err | Fresh Err |'
  );
  console.log(
    '|--------|-----------|----------|--------|------------|-----------|'
  );

  for (const w of FRESH_VALUES) {
    const trades = await loadMakerTrades(client, w.wallet);
    const result = processWallet(trades, resolutions);

    const legacyErr =
      w.legacyPnl !== 0
        ? ((result.total - w.legacyPnl) / Math.abs(w.legacyPnl)) * 100
        : 0;
    const freshErr =
      w.freshPnl !== 0
        ? ((result.total - w.freshPnl) / Math.abs(w.freshPnl)) * 100
        : 0;

    const fmt = (n: number) =>
      Math.abs(n) >= 1000
        ? (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1000).toFixed(1) + 'k'
        : '$' + n.toFixed(0);

    console.log(
      `| ${w.wallet.slice(0, 8)}.. | ${fmt(w.legacyPnl).padStart(9)} | ${fmt(w.freshPnl).padStart(8)} | ${fmt(result.total).padStart(6)} | ${legacyErr.toFixed(0).padStart(9)}% | ${freshErr.toFixed(0).padStart(8)}% |`
    );
  }

  console.log('\n=== INTERPRETATION ===');
  console.log('If Fresh Err is closer to 0% than Legacy Err, staleness is the issue.');
  console.log('If both errors are large, there may be a fundamental engine problem.');
}

main().catch(console.error);
