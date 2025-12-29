import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = process.argv[2]?.toLowerCase();
if (!WALLET) {
  console.error('Usage: npx tsx scripts/copytrade/split-taker-vs-maker.ts <wallet>');
  process.exit(1);
}

async function main() {
  const q = `
    WITH wallet_tx AS (
      SELECT
        lower(concat('0x', hex(transaction_hash))) as tx_hash,
        maxIf(1, role = 'taker' AND side = 'sell') as has_taker_sell,
        maxIf(1, role = 'maker' AND side = 'sell') as has_maker_sell,
        maxIf(1, side = 'sell') as has_any_sell
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trader_wallet = '${WALLET}'
      GROUP BY tx_hash
    )
    SELECT
      sumIf(toFloat64OrZero(amount_or_payout)/1e6, tx_hash IN (SELECT tx_hash FROM wallet_tx WHERE has_any_sell = 1)) as split_any_sell,
      sumIf(toFloat64OrZero(amount_or_payout)/1e6, tx_hash IN (SELECT tx_hash FROM wallet_tx WHERE has_taker_sell = 1)) as split_taker_sell,
      sumIf(toFloat64OrZero(amount_or_payout)/1e6, tx_hash IN (SELECT tx_hash FROM wallet_tx WHERE has_maker_sell = 1)) as split_maker_sell
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit' AND is_deleted = 0
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = await r.json();
  console.log(`=== Split attribution sums for ${WALLET} ===`);
  console.log(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
