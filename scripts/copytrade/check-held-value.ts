import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';

const wallet = process.argv[2]?.toLowerCase();
if (!wallet) {
  console.error('Usage: npx tsx scripts/copytrade/check-held-value.ts <wallet>');
  process.exit(1);
}

async function main() {
  const q = `
    WITH trades AS (
      SELECT
        token_id,
        sumIf(token_amount, side = 'buy') / 1e6 as bought,
        sumIf(token_amount, side = 'sell') / 1e6 as sold
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trader_wallet = '${wallet}'
      GROUP BY token_id
    ),
    patch_deduped AS (
      SELECT token_id_dec, any(condition_id) as condition_id, any(outcome_index) as outcome_index
      FROM pm_token_to_condition_patch
      GROUP BY token_id_dec
    ),
    mapped AS (
      SELECT
        t.token_id,
        COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) as condition_id,
        COALESCE(if(p.condition_id != '', p.outcome_index, NULL), g.outcome_index) as outcome_index,
        (t.bought - t.sold) as net
      FROM trades t
      LEFT JOIN pm_token_to_condition_map_v5 g ON t.token_id = g.token_id_dec
      LEFT JOIN patch_deduped p ON t.token_id = p.token_id_dec
      WHERE (t.bought - t.sold) > 0
        AND COALESCE(NULLIF(p.condition_id, ''), NULLIF(g.condition_id, '')) != ''
    )
    SELECT
      sum(m.net * r.resolved_price) as held_value,
      sumIf(m.net, r.resolved_price = 1) as winner_tokens,
      count() as pos_tokens
    FROM mapped m
    LEFT JOIN vw_pm_resolution_prices r
      ON m.condition_id = r.condition_id AND m.outcome_index = r.outcome_index
  `;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  console.log(await r.json());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
