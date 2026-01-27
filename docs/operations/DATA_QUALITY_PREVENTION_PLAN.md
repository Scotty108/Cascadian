# Data Quality Prevention Plan

**Created:** January 27, 2026
**Context:** Response to Jan 2026 data corruption incident
**Owner:** Engineering Team

---

## Executive Summary

This document outlines comprehensive measures to prevent data quality incidents like the January 2026 canonical fills corruption. The plan focuses on four pillars:

1. **Automated Monitoring** - Catch issues within minutes
2. **Testing & Validation** - Prevent bugs from reaching production
3. **Code Standards** - Enforce consistency between backfill and incremental logic
4. **Process Improvements** - Better deployment and review practices

---

## 1. Automated Monitoring & Alerting

### 1.1 Real-Time Data Quality Metrics

**Create health monitoring table:**

```sql
CREATE TABLE pm_data_quality_metrics (
  check_name LowCardinality(String),
  check_time DateTime DEFAULT now(),
  metric_value Float64,
  threshold_warning Float64,
  threshold_critical Float64,
  status LowCardinality(String), -- 'OK', 'WARNING', 'CRITICAL'
  details String DEFAULT ''
) ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', check_time)
ORDER BY (check_name, check_time)
TTL check_time + INTERVAL 30 DAY
SETTINGS index_granularity = 8192;
```

**Implement in cron:** `app/api/cron/monitor-data-quality/route.ts`

```typescript
import { clickhouse } from '@/lib/clickhouse/client';
import { sendSlackAlert } from '@/lib/alerts/slack';

export async function GET() {
  const checks = [
    {
      name: 'canonical_fills_empty_condition_pct',
      query: `
        SELECT
          countIf(condition_id = '') * 100.0 / count() as pct_empty
        FROM pm_canonical_fills_v4
        WHERE source = 'clob'
          AND event_time >= now() - INTERVAL 1 HOUR
      `,
      warning: 0.1,   // Warn at 0.1%
      critical: 1.0,  // Critical at 1%
    },
    {
      name: 'canonical_fills_null_wallet_pct',
      query: `
        SELECT
          countIf(wallet = '0x0000000000000000000000000000000000000000') * 100.0 / count() as pct_null
        FROM pm_canonical_fills_v4
        WHERE event_time >= now() - INTERVAL 1 HOUR
      `,
      warning: 0.1,
      critical: 1.0,
    },
    {
      name: 'token_map_coverage_14d',
      query: `
        SELECT
          countIf(map.token_id_dec IS NULL) * 100.0 / count() as pct_unmapped
        FROM (
          SELECT DISTINCT token_id
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
        ) r
        LEFT JOIN pm_token_to_condition_map_v5 map ON r.token_id = map.token_id_dec
      `,
      warning: 1.0,   // Warn at 1% unmapped
      critical: 5.0,  // Critical at 5% unmapped
    },
    {
      name: 'fifo_roi_coverage_24h',
      query: `
        WITH resolved_today AS (
          SELECT count(DISTINCT condition_id) as total
          FROM pm_condition_resolutions
          WHERE resolved_at >= now() - INTERVAL 24 HOUR
            AND is_deleted = 0
            AND payout_numerators != ''
        ),
        in_fifo AS (
          SELECT count(DISTINCT condition_id) as in_table
          FROM pm_trade_fifo_roi_v3
          WHERE resolved_at >= now() - INTERVAL 24 HOUR
        )
        SELECT
          (resolved.total - fifo.in_table) * 100.0 / resolved.total as pct_missing
        FROM resolved_today resolved, in_fifo fifo
      `,
      warning: 5.0,   // Warn at 5% missing
      critical: 20.0, // Critical at 20% missing
    },
  ];

  const alerts = [];

  for (const check of checks) {
    const result = await clickhouse.query({ query: check.query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    const value = rows[0] ? Object.values(rows[0])[0] as number : 0;

    let status = 'OK';
    if (value >= check.critical) {
      status = 'CRITICAL';
      alerts.push({ check: check.name, value, threshold: check.critical, status });
    } else if (value >= check.warning) {
      status = 'WARNING';
      alerts.push({ check: check.name, value, threshold: check.warning, status });
    }

    // Log metric
    await clickhouse.command({
      query: `
        INSERT INTO pm_data_quality_metrics (check_name, metric_value, threshold_warning, threshold_critical, status)
        VALUES ('${check.name}', ${value}, ${check.warning}, ${check.critical}, '${status}')
      `,
    });
  }

  // Send Slack alerts for any warnings/criticals
  if (alerts.length > 0) {
    await sendSlackAlert({
      channel: '#data-quality-alerts',
      severity: alerts.some(a => a.status === 'CRITICAL') ? 'critical' : 'warning',
      title: `Data Quality Alert: ${alerts.length} checks failing`,
      details: alerts.map(a => `- ${a.check}: ${a.value.toFixed(2)}% (threshold: ${a.threshold}%)`).join('\n'),
    });
  }

  return NextResponse.json({ success: true, alerts, timestamp: new Date() });
}
```

**Schedule:** Every 10 minutes via Vercel Cron
```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/monitor-data-quality",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

---

### 1.2 Grafana Dashboard (Optional)

If using Grafana with ClickHouse datasource:

**Panel 1: Empty Condition ID Percentage (Last 24h)**
```sql
SELECT
  toStartOfHour(event_time) as time,
  countIf(condition_id = '') * 100.0 / count() as pct_empty
FROM pm_canonical_fills_v4
WHERE source = 'clob'
  AND event_time >= now() - INTERVAL 24 HOUR
GROUP BY time
ORDER BY time
```

**Panel 2: Token Map Coverage Trend**
```sql
SELECT
  check_time,
  metric_value
FROM pm_data_quality_metrics
WHERE check_name = 'token_map_coverage_14d'
  AND check_time >= now() - INTERVAL 7 DAY
ORDER BY check_time
```

---

## 2. Testing & Validation Framework

### 2.1 Integration Tests

**File:** `tests/integration/canonical-fills.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { clickhouse } from '@/lib/clickhouse/client';

describe('Canonical Fills Data Integrity', () => {

  it('incremental update should not insert empty condition_ids', async () => {
    // Insert test trader event with unmapped token
    await clickhouse.command({
      query: `
        INSERT INTO pm_trader_events_v3
        (event_id, trader_wallet, role, side, token_id, usdc_amount, token_amount, fee_amount, trade_time, transaction_hash, block_number)
        VALUES
        ('test_unmapped_token', '0xtest', 'taker', 'buy', '999999999999999', 1000000, 1000000, 0, now(), '0xtest', 999999999)
      `,
    });

    // Run incremental update (simulate cron)
    const watermark = { source: 'clob', last_block_number: 999999990, last_event_time: '2026-01-27' };
    await processCLOB(watermark);

    // Check that fill was NOT inserted (filtered out by JOIN)
    const result = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE wallet = '0xtest'`,
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    expect(rows[0].cnt).toBe(0);

    // Cleanup
    await clickhouse.command({ query: `DELETE FROM pm_trader_events_v3 WHERE event_id = 'test_unmapped_token'` });
  });

  it('incremental update should match backfill logic', async () => {
    // Create test data with mapped token
    const testConditionId = 'test_condition_123';
    const testTokenId = '888888888888888';

    // Insert token mapping
    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_map_v5 (token_id_dec, condition_id, outcome_index, question, category)
        VALUES ('${testTokenId}', '${testConditionId}', 0, 'Test Question', 'Test')
      `,
    });

    // Insert trader event
    await clickhouse.command({
      query: `
        INSERT INTO pm_trader_events_v3
        (event_id, trader_wallet, role, side, token_id, usdc_amount, token_amount, fee_amount, trade_time, transaction_hash, block_number)
        VALUES
        ('test_mapped_token', '0xtestmapped', 'taker', 'buy', '${testTokenId}', 1000000, 1000000, 0, now(), '0xtestmapped', 999999999)
      `,
    });

    // Run incremental update
    const watermark = { source: 'clob', last_block_number: 999999990, last_event_time: '2026-01-27' };
    await processCLOB(watermark);

    // Verify fill was inserted with correct condition_id
    const result = await clickhouse.query({
      query: `
        SELECT condition_id, outcome_index
        FROM pm_canonical_fills_v4
        WHERE wallet = '0xtestmapped'
      `,
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    expect(rows[0].condition_id).toBe(testConditionId);
    expect(rows[0].outcome_index).toBe(0);

    // Cleanup
    await clickhouse.command({ query: `DELETE FROM pm_canonical_fills_v4 WHERE wallet = '0xtestmapped'` });
    await clickhouse.command({ query: `DELETE FROM pm_trader_events_v3 WHERE event_id = 'test_mapped_token'` });
    await clickhouse.command({ query: `DELETE FROM pm_token_to_condition_map_v5 WHERE token_id_dec = '${testTokenId}'` });
  });

  it('should never have empty condition_ids in production data', async () => {
    const result = await clickhouse.query({
      query: `
        SELECT count() as empty_count
        FROM pm_canonical_fills_v4
        WHERE condition_id = ''
          AND event_time >= now() - INTERVAL 1 HOUR
      `,
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    expect(rows[0].empty_count).toBe(0);
  });
});
```

**Run tests in CI/CD:**
```bash
# .github/workflows/test.yml
- name: Run integration tests
  run: npm run test:integration
  env:
    CLICKHOUSE_HOST: ${{ secrets.CLICKHOUSE_HOST }}
    CLICKHOUSE_PASSWORD: ${{ secrets.CLICKHOUSE_PASSWORD }}
```

---

### 2.2 Pre-Deployment Validation

**File:** `scripts/validate-canonical-fills-logic.ts`

```typescript
/**
 * Validation script to ensure incremental update matches backfill logic
 * Run before deploying any changes to canonical fills processing
 */

import { clickhouse } from '../lib/clickhouse/client';

async function validateJoinLogic() {
  console.log('🔍 Validating canonical fills JOIN logic...\n');

  // Extract JOIN type from both scripts
  const incrementalScript = await fs.readFile('scripts/cron/update-canonical-fills.ts', 'utf-8');
  const backfillScript = await fs.readFile('scripts/backfill-canonical-fills-v4.ts', 'utf-8');

  // Check 1: Both should use INNER JOIN (or just JOIN), not LEFT JOIN
  const incrementalJoin = incrementalScript.match(/FROM pm_trader_events_v3.*?JOIN pm_token_to_condition_map_v5/s)?.[0];
  const backfillJoin = backfillScript.match(/FROM pm_trader_events_v3.*?JOIN pm_token_to_condition_map_v5/s)?.[0];

  if (!incrementalJoin || !backfillJoin) {
    throw new Error('❌ Could not find JOIN statements in scripts');
  }

  if (incrementalJoin.includes('LEFT JOIN')) {
    throw new Error('❌ Incremental update uses LEFT JOIN - should be INNER JOIN');
  }

  if (!incrementalJoin.includes("condition_id != ''")) {
    throw new Error("❌ Incremental update missing filter: m.condition_id != ''");
  }

  console.log('✅ Check 1: JOIN logic matches between scripts');

  // Check 2: No empty condition_ids in recent data
  const recentEmptyResult = await clickhouse.query({
    query: `
      SELECT countIf(condition_id = '') as empty_count
      FROM pm_canonical_fills_v4
      WHERE source = 'clob'
        AND event_time >= now() - INTERVAL 1 HOUR
    `,
    format: 'JSONEachRow',
  });
  const recentEmpty = ((await recentEmptyResult.json()) as any[])[0].empty_count;

  if (recentEmpty > 0) {
    throw new Error(`❌ Found ${recentEmpty} fills with empty condition_ids in last hour`);
  }

  console.log('✅ Check 2: No empty condition_ids in recent data');

  // Check 3: Token map coverage is adequate
  const coverageResult = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(map.token_id_dec IS NOT NULL) as mapped,
        round(countIf(map.token_id_dec IS NOT NULL) * 100.0 / count(), 2) as coverage_pct
      FROM (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
      ) r
      LEFT JOIN pm_token_to_condition_map_v5 map ON r.token_id = map.token_id_dec
    `,
    format: 'JSONEachRow',
  });
  const coverage = ((await coverageResult.json()) as any[])[0];

  if (coverage.coverage_pct < 95) {
    console.warn(`⚠️  Warning: Token map coverage is ${coverage.coverage_pct}% (should be >95%)`);
  } else {
    console.log(`✅ Check 3: Token map coverage is ${coverage.coverage_pct}%`);
  }

  console.log('\n✅ All validation checks passed!');
}

validateJoinLogic().catch(e => {
  console.error('❌ Validation failed:', e.message);
  process.exit(1);
});
```

**Add to package.json:**
```json
{
  "scripts": {
    "validate:canonical-fills": "npx tsx scripts/validate-canonical-fills-logic.ts"
  }
}
```

**Add to pre-commit hook:**
```bash
#!/bin/bash
# .git/hooks/pre-commit

if git diff --cached --name-only | grep -q "canonical-fills"; then
  echo "Detected changes to canonical fills logic..."
  npm run validate:canonical-fills || exit 1
fi
```

---

## 3. Code Standards & Patterns

### 3.1 Canonical Fills JOIN Pattern (Required)

**ALWAYS use this pattern for CLOB fills:**

```sql
FROM pm_trader_events_v3 t
JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
WHERE ...
  AND m.condition_id != ''
  AND ...
```

**NEVER use:**
```sql
-- ❌ WRONG - allows unmapped tokens
FROM pm_trader_events_v3 t
LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
```

### 3.2 Code Review Checklist

Before merging ANY changes to canonical fills processing:

- [ ] Uses INNER JOIN (or just `JOIN`), NOT `LEFT JOIN`
- [ ] Includes explicit filter: `m.condition_id != ''`
- [ ] Matches corresponding backfill script logic
- [ ] Has integration test covering the change
- [ ] Validation script passes (`npm run validate:canonical-fills`)
- [ ] Deployment plan includes monitoring for 24h after deploy

### 3.3 File Organization

Keep backfill and incremental logic synchronized:

```
scripts/
  backfill-canonical-fills-v4.ts   ← Source of truth for JOIN logic
  cron/
    update-canonical-fills.ts       ← Must match backfill JOIN pattern
```

**Shared logic (future improvement):**
Consider extracting common query builder:

```typescript
// lib/canonical-fills/query-builder.ts
export function buildCLOBInsertQuery(whereClause: string) {
  return `
    INSERT INTO pm_canonical_fills_v4 (...)
    SELECT ...
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE ${whereClause}
      AND m.condition_id != ''
      AND ...
  `;
}

// Use in both backfill and incremental:
const query = buildCLOBInsertQuery(`t.trade_time >= '${startDate}' AND t.trade_time < '${endDate}'`);
```

---

## 4. Process Improvements

### 4.1 Deployment Checklist

For any changes affecting data processing:

**Pre-Deployment:**
- [ ] Run validation script locally
- [ ] Run integration tests
- [ ] Review diff to ensure JOIN logic correct
- [ ] Document expected impact (if any)

**Deployment:**
- [ ] Deploy during low-traffic hours if possible
- [ ] Monitor data quality metrics for first hour
- [ ] Check Slack alerts channel

**Post-Deployment (24h monitoring):**
- [ ] Verify empty condition_id percentage < 0.1%
- [ ] Check token map coverage stays > 95%
- [ ] Spot-check 3-5 wallets for PnL accuracy
- [ ] Review any alerts triggered

### 4.2 Incident Response Plan

If data quality alerts fire:

**Severity: WARNING (0.1% - 1% empty fills)**
1. Check recent code deployments (last 6 hours)
2. Review token map rebuild cron status
3. Investigate sample empty fills
4. If trend worsening, escalate to CRITICAL

**Severity: CRITICAL (>1% empty fills)**
1. **IMMEDIATELY** pause deployments
2. Check if incremental update cron is running
3. Compare recent code vs backfill script
4. If JOIN logic diverged, revert immediately
5. Create incident doc in `/docs/operations/`
6. Start data recovery process if needed

**Escalation:**
- On-call engineer notified immediately via PagerDuty
- Engineering lead notified if issue persists > 30 min
- PM notified if user-facing impact expected

### 4.3 Regular Audits

**Monthly Data Quality Review:**
- Review all data quality metrics from past month
- Check for any degradation trends
- Update thresholds if false positives
- Document any incidents and resolutions

**Quarterly Code Audit:**
- Review all canonical fills processing code
- Ensure backfill and incremental still match
- Update tests for new edge cases
- Review and update this prevention plan

---

## 5. Documentation Requirements

### 5.1 Required Documentation

For ANY new data processing pipeline:

1. **Architecture doc** explaining data flow
2. **Backfill script** with correct JOIN logic
3. **Incremental update script** matching backfill
4. **Integration tests** validating correctness
5. **Monitoring queries** for data quality

### 5.2 Inline Code Comments

Use standardized comments for critical JOIN patterns:

```typescript
// CRITICAL: Use INNER JOIN to exclude unmapped tokens
// This prevents empty condition_ids in canonical fills
// See: docs/operations/DATA_QUALITY_PREVENTION_PLAN.md
FROM pm_trader_events_v3 t
JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
WHERE m.condition_id != ''  // Required filter - do not remove
```

---

## 6. Implementation Timeline

### Phase 1: Immediate (This Week)
- [x] Fix incremental update JOIN logic
- [ ] Add monitoring cron job
- [ ] Set up Slack alerts
- [ ] Create validation script

### Phase 2: Short-term (Next 2 Weeks)
- [ ] Write integration tests
- [ ] Add pre-commit validation hook
- [ ] Document code review checklist
- [ ] Set up Grafana dashboards (optional)

### Phase 3: Medium-term (Next Month)
- [ ] Extract shared query builder
- [ ] Create monthly audit process
- [ ] Document incident response playbook
- [ ] Train team on new processes

---

## 7. Success Metrics

Track these KPIs to measure prevention effectiveness:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Empty condition_id % | < 0.01% | Continuous monitoring |
| Token map coverage | > 98% | Daily check |
| Time to detect issues | < 15 min | Alert lag time |
| Mean time to recovery | < 2 hours | From alert to fix |
| False positive rate | < 5% | Monthly review |

---

## 8. Lessons Learned

From Jan 2026 incident:

1. **Divergent code paths are dangerous** - Backfill and incremental logic must stay in sync
2. **Silent failures are deadly** - Need monitoring to catch issues immediately
3. **100% test coverage isn't enough** - Need integration tests that validate actual behavior
4. **Cron success != data quality** - Token map rebuild was "succeeding" while reporting 0 new tokens
5. **Defensive coding pays off** - Explicit filters (condition_id != '') prevent subtle bugs

---

## Appendix A: Related Documents

- [Data Corruption Incident Report](./DATA_CORRUPTION_JAN2026_INCIDENT.md)
- [Canonical Fills Architecture](../systems/CANONICAL_FILLS.md) (to be created)
- [Token Mapping System](../systems/TOKEN_MAPPING.md) (to be created)

---

## Document Maintenance

**Last Updated:** 2026-01-27
**Next Review:** 2026-02-27 (monthly)
**Owner:** Engineering Team

**Change Log:**
- 2026-01-27: Initial version created in response to Jan 2026 incident
