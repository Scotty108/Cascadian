import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
import { clickhouse } from '../../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcea0d127d72a9019956a18333a62fce3b13e5994';
  
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
        round(t.usdc_amount / 1e6, 2) as usdc,
        round((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0), 3) as entry_price,
        multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) as outcome,
        round(CASE
          WHEN lower(t.side) = 'buy'
          THEN ((multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) /
                ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0))) - 1) * 10000
          ELSE (1 - (multiIf(t.token_id = r.yes_token, r.yes_payout, t.token_id = r.no_token, r.no_payout, 0) /
                ((t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0)))) * 10000
        END, 0) as markout_bps
      FROM pm_trader_events_dedup_v2_tbl t
      JOIN resolved r ON t.token_id = r.yes_token OR t.token_id = r.no_token
      WHERE t.trader_wallet = '${wallet}'
        AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) > 0.10
        AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) < 0.90
      ORDER BY t.trade_date DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  
  console.log('=== TOP WALLET SAMPLE FILLS ===');
  console.log('Wallet:', wallet);
  console.log('');
  console.log('Date       | Side | USDC  | Entry | Out | Markout');
  for (const r of rows) {
    console.log(r.trade_date, '|', r.side.padEnd(4), '|', String(r.usdc).padStart(5), '|', String(r.entry_price).padStart(5), '|', r.outcome, '|', r.markout_bps);
  }
  
  // Count wins vs losses
  const wins = rows.filter((r: any) => r.markout_bps > 0).length;
  const losses = rows.filter((r: any) => r.markout_bps < 0).length;
  console.log('\nWins:', wins, 'Losses:', losses);
  console.log('Unique markout values:', [...new Set(rows.map((r: any) => r.markout_bps))].join(', '));
}
main().catch(console.error);
