/**
 * Data quality check definitions and evaluation logic.
 * Extracted from the monitor-data-quality cron for testability.
 */

export interface DataQualityCheck {
  name: string
  query: string
  warning: number
  critical: number
  description: string
}

export interface CheckResult {
  name: string
  value: number
  status: 'OK' | 'WARNING' | 'CRITICAL'
  description: string
}

/**
 * All known production tables that checks may reference.
 * Used in tests to catch stale/wrong table names.
 */
export const KNOWN_TABLES: string[] = [
  'pm_canonical_fills_v4',
  'pm_condition_resolutions',
  'pm_trade_fifo_roi_v3',
  'pm_trader_events_v3',
  'pm_token_to_condition_map_v5',
  'pm_ingest_watermarks_v1',
  'pm_copy_trading_leaderboard',
  'pm_smart_money_cache',
  'pm_latest_mark_price_v1',
  'pm_wallet_position_fact_v1',
  'pm_ctf_split_merge_expanded',
  'pm_trade_fifo_roi_v3_mat_unified',
  'pm_trade_fifo_roi_v3_mat_deduped',
]

/**
 * Evaluate a metric value against a check's thresholds.
 * Negative values (sentinel for query failure) are always CRITICAL.
 */
export function evaluateStatus(
  value: number,
  check: DataQualityCheck
): 'OK' | 'WARNING' | 'CRITICAL' {
  if (value < 0) return 'CRITICAL'
  if (value >= check.critical) return 'CRITICAL'
  if (value >= check.warning) return 'WARNING'
  return 'OK'
}

/**
 * Build an alert message from check results.
 * Returns null if no CRITICAL results.
 */
export function buildAlertMessage(results: CheckResult[]): string | null {
  const failures = results.filter(r => r.status === 'CRITICAL')
  if (failures.length === 0) return null
  return `${failures.length} CRITICAL issues:\n${failures.map(f => `- ${f.name}: ${f.value.toFixed(2)} (${f.description})`).join('\n')}`
}

/**
 * Data quality checks run every 10 minutes by monitor-data-quality cron.
 *
 * Threshold guidelines:
 * - Percentage checks (pct/coverage): warning < 25%, critical < 50%
 * - Count checks: set based on observed production baselines
 * - Freshness checks (hours/minutes): set based on expected cron cycle
 */
export const CHECKS: DataQualityCheck[] = [
  {
    name: 'canonical_fills_empty_condition_pct',
    description: 'Empty condition_ids in canonical fills (last hour)',
    query: `
      SELECT
        countIf(condition_id = '') * 100.0 / count() as metric_value
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND event_time >= now() - INTERVAL 1 HOUR
    `,
    warning: 0.1,
    critical: 1.0,
  },
  {
    name: 'canonical_fills_null_wallet_pct',
    description: 'Null wallets in canonical fills (last hour)',
    query: `
      SELECT
        countIf(wallet = '0x0000000000000000000000000000000000000000') * 100.0 / count() as metric_value
      FROM pm_canonical_fills_v4
      WHERE event_time >= now() - INTERVAL 1 HOUR
    `,
    warning: 0.1,
    critical: 1.0,
  },
  {
    name: 'token_map_coverage_recent',
    description: 'Unmapped token % in trades from 1-6h ago (excludes brand-new tokens)',
    query: `
      SELECT
        countIf(token_id NOT IN (
          SELECT token_id_dec FROM pm_token_to_condition_map_v5
        )) * 100.0 / count() as metric_value
      FROM (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v3
        WHERE trade_time >= now() - INTERVAL 6 HOUR
          AND trade_time <= now() - INTERVAL 1 HOUR
        LIMIT 10000
      )
    `,
    warning: 20.0,
    critical: 40.0,
  },
  {
    name: 'incremental_update_health',
    description: 'Last canonical fills watermark updated within 30 minutes',
    query: `
      SELECT
        CASE
          WHEN max(last_event_time) >= now() - INTERVAL 30 MINUTE THEN 0
          ELSE dateDiff('minute', max(last_event_time), now())
        END as metric_value
      FROM pm_ingest_watermarks_v1 FINAL
      WHERE source = 'clob'
    `,
    warning: 30,
    critical: 60,
  },
  {
    name: 'fifo_missed_resolved_conditions',
    description: 'Resolved conditions (4h-48h ago) with CLOB fills missing from FIFO table',
    query: `
      SELECT
        total_with_fills - in_fifo as metric_value
      FROM (
        SELECT
          (SELECT count(DISTINCT condition_id)
           FROM pm_condition_resolutions
           WHERE is_deleted = 0
             AND payout_numerators != ''
             AND insert_time >= now() - INTERVAL 2 DAY
             AND insert_time <= now() - INTERVAL 4 HOUR
             AND condition_id IN (SELECT DISTINCT condition_id FROM pm_canonical_fills_v4 WHERE source = 'clob')
          ) as total_with_fills,
          (SELECT count(DISTINCT condition_id)
           FROM pm_condition_resolutions
           WHERE is_deleted = 0
             AND payout_numerators != ''
             AND insert_time >= now() - INTERVAL 2 DAY
             AND insert_time <= now() - INTERVAL 4 HOUR
             AND condition_id IN (SELECT DISTINCT condition_id FROM pm_canonical_fills_v4 WHERE source = 'clob')
             AND condition_id IN (SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3)
          ) as in_fifo
      )
    `,
    warning: 500,
    critical: 3000,
  },
  {
    name: 'fifo_resolution_freshness_hours',
    description: 'Hours since last resolution was processed into FIFO',
    query: `
      SELECT
        dateDiff('hour', max(resolved_at), now()) as metric_value
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at > '2020-01-01'
    `,
    warning: 6,
    critical: 24,
  },
  {
    name: 'condition_resolutions_freshness_hours',
    description: 'Hours since last condition resolution was ingested',
    query: `
      SELECT
        dateDiff('hour', max(insert_time), now()) as metric_value
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    warning: 2,
    critical: 6,
  },
]
