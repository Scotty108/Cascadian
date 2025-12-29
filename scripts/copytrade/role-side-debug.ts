import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';

const wallet = (process.argv[2] || '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e').toLowerCase();

async function main() {
  const q = `
    WITH deduped AS (
      SELECT
        replaceRegexpAll(event_id, '-[mt]$', '') as base_id,
        any(role) as role,
        any(side) as side,
        any(usdc_amount)/1e6 as usdc,
        any(token_amount)/1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
      GROUP BY base_id
    )
    SELECT role, side, count() as cnt, sum(usdc) as usdc, sum(tokens) as tokens
    FROM deduped
    GROUP BY role, side
    ORDER BY role, side
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as Array<{ role: string; side: string; cnt: number; usdc: number; tokens: number }>;
  console.log(rows);

  let rawBuyTokens = 0;
  let rawSellTokens = 0;
  let flipBuyTokens = 0;
  let flipSellTokens = 0;

  for (const row of rows) {
    if (row.side === 'buy') rawBuyTokens += Number(row.tokens) || 0;
    if (row.side === 'sell') rawSellTokens += Number(row.tokens) || 0;

    const effectiveSide =
      row.role === 'maker' ? (row.side === 'buy' ? 'sell' : 'buy') : row.side;
    if (effectiveSide === 'buy') flipBuyTokens += Number(row.tokens) || 0;
    if (effectiveSide === 'sell') flipSellTokens += Number(row.tokens) || 0;
  }

  console.log('\nToken flow:');
  console.log(`  Raw:   buy=${rawBuyTokens.toFixed(2)} sell=${rawSellTokens.toFixed(2)} net=${(rawBuyTokens-rawSellTokens).toFixed(2)}`);
  console.log(`  Flip:  buy=${flipBuyTokens.toFixed(2)} sell=${flipSellTokens.toFixed(2)} net=${(flipBuyTokens-flipSellTokens).toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
