import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = (process.argv[2] || '').toLowerCase();

if (!WALLET) {
  console.error('Usage: npx tsx scripts/copytrade/role-side-breakdown.ts <wallet>');
  process.exit(1);
}

async function main() {
  const q = `
    SELECT
      side,
      role,
      sum(token_amount) / 1e6 as tokens,
      sum(usdc_amount) / 1e6 as usdc,
      count() as n
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${WALLET}'
    GROUP BY side, role
    ORDER BY role, side
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as Array<{ side: string; role: string; tokens: number; usdc: number; n: number }>;

  console.log(`=== Role/Side Breakdown: ${WALLET} ===`);
  for (const row of rows) {
    console.log(
      `${row.role.padEnd(6)} ${row.side.padEnd(4)} tokens=${row.tokens.toFixed(2)} usdc=${row.usdc.toFixed(2)} n=${row.n}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
