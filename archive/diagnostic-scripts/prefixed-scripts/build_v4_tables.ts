import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '8miOkWI~OhsDb',
  database: process.env.CLICKHOUSE_DATABASE || 'default'
});

async function buildV4Table() {
  console.log('='.repeat(80));
  console.log('BUILD V4 TABLES');
  console.log('='.repeat(80));

  console.log('\n[Step 1] Dropping existing pm_trades_canonical_v4 if exists...');
  await client.command({
    query: `DROP TABLE IF EXISTS pm_trades_canonical_v4`
  });

  console.log('[Step 2] Creating pm_trades_canonical_v4...');
  const startTime = Date.now();

  await client.command({
    query: `
      CREATE TABLE pm_trades_canonical_v4
      ENGINE = ReplacingMergeTree(version)
      ORDER BY (trade_id, version)
      AS
      SELECT
        -- Primary Identifiers
        t.trade_id AS trade_id,
        t.trade_key AS trade_key,
        t.transaction_hash AS transaction_hash,
        t.wallet_address AS wallet_address,

        -- V2 Columns (preserve)
        t.condition_id_norm_v2,
        t.outcome_index_v2,
        t.market_id_norm_v2,

        -- V3 Columns (preserve)
        t.condition_id_norm_v3,
        t.outcome_index_v3,
        t.market_id_norm_v3,
        t.condition_source_v3,

        -- V4 Columns (new repair layer)
        COALESCE(r.repair_condition_id, t.condition_id_norm_v3) AS condition_id_norm_v4,
        COALESCE(r.repair_outcome_index, t.outcome_index_v3) AS outcome_index_v4,

        -- Market ID from joined dim_markets or fallback to v3
        COALESCE(m.market_id, t.market_id_norm_v3) AS market_id_norm_v4,

        -- Repair provenance
        CASE
          WHEN r.repair_condition_id IS NOT NULL THEN r.repair_source
          WHEN t.condition_id_norm_v3 IS NOT NULL THEN t.condition_source_v3
          ELSE 'none'
        END AS condition_source_v4,

        -- Original columns (preserve)
        t.condition_id_norm_orig,
        t.outcome_index_orig,
        t.market_id_norm_orig,

        -- Trade details
        t.trade_direction,
        t.direction_confidence,
        t.shares,
        t.price,
        t.usd_value,
        t.fee,

        -- Temporal
        t.timestamp,
        t.created_at AS created_at,

        -- Source tracking
        t.source,

        -- V4 repair tracking
        CASE
          WHEN r.repair_condition_id IS NOT NULL THEN r.repair_source
          ELSE t.id_repair_source
        END AS id_repair_source,

        CASE
          WHEN r.repair_condition_id IS NOT NULL THEN r.repair_confidence
          ELSE t.id_repair_confidence
        END AS id_repair_confidence,

        -- Orphan tracking (updated for v4)
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
        END AS orphan_reason,

        -- Version tracking
        now() AS version

      FROM pm_trades_canonical_v3 t
      LEFT JOIN pm_v4_repair_map r ON t.transaction_hash = r.transaction_hash
      LEFT JOIN dim_markets m ON COALESCE(r.repair_condition_id, t.condition_id_norm_v3) = m.condition_id_norm
    `,
    clickhouse_settings: {
      max_execution_time: 1800, // 30 minutes
      max_memory_usage: 20000000000 // 20GB
    }
  });

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`✓ pm_trades_canonical_v4 created in ${duration}s`);

  // Get row count
  const count = await client.query({
    query: 'SELECT count() AS cnt FROM pm_trades_canonical_v4',
    format: 'JSONEachRow'
  });
  const countData = await count.json();
  console.log(`  Rows: ${Number(countData[0].cnt).toLocaleString()}`);
}

async function buildV4View() {
  console.log('\n[Step 3] Creating vw_trades_canonical_v4...');

  await client.command({
    query: `
      CREATE OR REPLACE VIEW vw_trades_canonical_v4 AS
      SELECT
        -- Primary Identifiers
        trade_id,
        trade_key,
        transaction_hash,
        wallet_address,

        -- V2 Columns
        condition_id_norm_v2,
        outcome_index_v2,
        market_id_norm_v2,

        -- V3 Columns
        condition_id_norm_v3,
        outcome_index_v3,
        market_id_norm_v3,
        condition_source_v3,

        -- V4 Columns (Primary for new consumers)
        condition_id_norm_v4,
        outcome_index_v4,
        market_id_norm_v4,
        condition_source_v4,

        -- Canonical columns (v4-first overlay)
        condition_id_norm_v4 AS canonical_condition_id,
        outcome_index_v4 AS canonical_outcome_index,
        market_id_norm_v4 AS canonical_market_id,
        condition_source_v4 AS canonical_condition_source,

        -- Original IDs
        condition_id_norm_orig,
        outcome_index_orig,
        market_id_norm_orig,

        -- Trade details
        trade_direction,
        direction_confidence,
        shares,
        price,
        usd_value,
        fee,

        -- Temporal
        timestamp,
        created_at,

        -- Source tracking
        source,
        id_repair_source,
        id_repair_confidence,

        -- Orphan tracking
        is_orphan,
        orphan_reason

      FROM pm_trades_canonical_v4
    `
  });

  console.log('✓ vw_trades_canonical_v4 created');
}

async function main() {
  try {
    await buildV4Table();
    await buildV4View();

    console.log('\n' + '='.repeat(80));
    console.log('V4 TABLES BUILD COMPLETE');
    console.log('='.repeat(80));

    await client.close();

  } catch (error) {
    console.error('Error:', error);
    await client.close();
    process.exit(1);
  }
}

main();
