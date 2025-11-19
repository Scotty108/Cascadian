import { clickhouse } from '../lib/clickhouse/client';

const createViewSQL = `
CREATE OR REPLACE VIEW vw_trades_canonical_v4_preview AS
SELECT
  t.trade_id,
  t.trade_key,
  t.transaction_hash,
  t.wallet_address,
  t.condition_id_norm_v2,
  t.outcome_index_v2,
  t.market_id_norm_v2,
  t.condition_id_norm_v3,
  t.outcome_index_v3,
  t.market_id_norm_v3,
  t.condition_source_v3,
  COALESCE(r.repair_condition_id, t.condition_id_norm_v3) AS condition_id_norm_v4,
  COALESCE(r.repair_outcome_index, t.outcome_index_v3) AS outcome_index_v4,
  COALESCE(dm.market_id, t.market_id_norm_v3) AS market_id_norm_v4,
  CASE
    WHEN r.repair_source IS NOT NULL THEN r.repair_source
    WHEN t.condition_id_norm_v3 IS NOT NULL THEN t.condition_source_v3
    ELSE 'none'
  END AS condition_source_v4,
  COALESCE(r.repair_condition_id, t.condition_id_norm_v3) AS canonical_condition_id,
  COALESCE(r.repair_outcome_index, t.outcome_index_v3) AS canonical_outcome_index,
  COALESCE(dm.market_id, t.market_id_norm_v3) AS canonical_market_id,
  CASE
    WHEN r.repair_source IS NOT NULL THEN r.repair_source
    WHEN t.condition_id_norm_v3 IS NOT NULL THEN t.condition_source_v3
    ELSE 'none'
  END AS canonical_condition_source,
  t.condition_id_norm_orig,
  t.outcome_index_orig,
  t.market_id_norm_orig,
  t.trade_direction,
  t.direction_confidence,
  t.shares,
  t.price,
  t.usd_value,
  t.fee,
  t.timestamp,
  t.created_at,
  t.source,
  CASE
    WHEN r.repair_source IS NOT NULL THEN r.repair_source
    ELSE t.id_repair_source
  END AS id_repair_source,
  CASE
    WHEN r.repair_confidence IS NOT NULL THEN r.repair_confidence
    ELSE t.id_repair_confidence
  END AS id_repair_confidence,
  CASE
    WHEN COALESCE(r.repair_condition_id, t.condition_id_norm_v3) IS NULL
      OR COALESCE(r.repair_condition_id, t.condition_id_norm_v3) = ''
      OR length(COALESCE(r.repair_condition_id, t.condition_id_norm_v3)) != 64
    THEN 1
    ELSE 0
  END AS is_orphan,
  CASE
    WHEN r.repair_condition_id IS NOT NULL THEN NULL
    ELSE t.orphan_reason
  END AS orphan_reason
FROM pm_trades_canonical_v3 t
LEFT JOIN pm_v4_repair_map r ON t.trade_id = r.trade_id
LEFT JOIN (
  SELECT condition_id_norm, anyHeavy(market_id) AS market_id
  FROM (SELECT * FROM dim_markets WHERE market_id != '')
  GROUP BY condition_id_norm
) dm ON dm.condition_id_norm = r.repair_condition_id
`;

async function main() {
  try {
    console.log('Creating vw_trades_canonical_v4_preview...\n');
    await clickhouse.exec({ query: createViewSQL });
    console.log('✅ View created successfully\n');

    console.log('Validating view creation...\n');
    const viewCheck = await clickhouse.query({
      query: `
        SELECT
          name,
          engine
        FROM system.tables
        WHERE name = 'vw_trades_canonical_v4_preview'
          AND database = currentDatabase()
      `,
      format: 'JSONEachRow'
    });

    const viewData = await viewCheck.json();
    console.log('View metadata:', JSON.stringify(viewData, null, 2));

    console.log('\nRunning coverage check...\n');
    const coverageCheck = await clickhouse.query({
      query: `
        SELECT
          count() AS total_trades,
          countIf(length(canonical_condition_id) = 64) AS has_cid,
          round(100.0 * has_cid / total_trades, 2) AS coverage_pct
        FROM vw_trades_canonical_v4_preview
      `,
      format: 'JSONEachRow'
    });

    const coverageData = await coverageCheck.json();
    console.log('Coverage:', JSON.stringify(coverageData, null, 2));

    console.log('\n✅ V4 preview view ready for internal testing');

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
