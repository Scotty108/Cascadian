/**
 * Sanity check high t-stat wallet
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

async function main() {
  const wallet = '0x955069b860aed4df4113f4fe3cdef91233ead284';
  
  const result = await clickhouse.query({
    query: `
      WITH resolved AS (
        SELECT
          m.condition_id,
          arrayElement(m.token_ids, 1) as yes_token,
          arrayElement(m.token_ids, 2) as no_token,
          toFloat64(JSONExtractInt(r.payout_numerators, 1)) as yes_payout,
          toFloat64(JSONExtractInt(r.payout_numerators, 2)) as no_payout
        FROM pm_market_metadata m
        JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
        WHERE r.is_deleted = 0
      )
      SELECT
        t.trade_date,
        t.side,
        t.usdc_amount / 1e6 as usdc,
        t.token_amount / 1e6 as tokens,
        (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) as entry_price,
        multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) as outcome,
        CASE
          WHEN lower(t.side) = 'buy'
          THEN ((multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) /
                ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0))) - 1) * 10000
          ELSE (1 - (multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) /
                ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0)))) * 10000
        END as markout_bps
      FROM pm_trader_events_dedup_v2_tbl t
      JOIN resolved r ON t.token_id = r.yes_token OR t.token_id = r.no_token
      WHERE t.trader_wallet = '${wallet}'
        AND t.trade_date >= today() - 30
      ORDER BY t.trade_date DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  
  console.log('=== SAMPLE FILLS FOR HIGH T-STAT WALLET ===');
  console.log('Wallet:', wallet);
  console.log('');
  console.log('Date       | Side | USDC   | Entry | Outcome | Markout (bps)');
  console.log('-----------|------|--------|-------|---------|-------------');
  for (const r of rows) {
    console.log(
      r.trade_date.toString().padEnd(11) + '| ' +
      r.side.padEnd(5) + '| ' +
      Number(r.usdc).toFixed(2).padStart(6) + ' | ' +
      Number(r.entry_price).toFixed(3).padStart(5) + ' | ' +
      String(r.outcome).padStart(7) + ' | ' +
      Number(r.markout_bps).toFixed(0).padStart(7)
    );
  }
  
  const wins = rows.filter((r: any) => r.markout_bps > 0).length;
  const losses = rows.filter((r: any) => r.markout_bps < 0).length;
  console.log('');
  console.log('Wins:', wins, 'Losses:', losses);
}

main().catch(console.error);
