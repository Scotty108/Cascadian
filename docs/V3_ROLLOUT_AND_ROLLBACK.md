# V3 PnL Rollout & Rollback Guide

**Date:** 2025-11-16 (PST)
**Status:** Infrastructure Ready - Feature Flag OFF (V2 Active)

---

## Overview

V3 PnL views provide **3x more wallet positions** (+215.72%) and **69% coverage** vs V2's 10% coverage. The rollout infrastructure is in place with feature flags to enable safe, reversible deployment.

**Current State:**
- ✅ V3 views created and validated (vw_wallet_market_pnl_v3)
- ✅ Feature flag infrastructure in place
- ✅ Daily monitoring script ready
- ❌ **Feature flag OFF** (production uses V2)
- ❌ No API routes switched to V3

---

## Feature Flag System

### Environment Variable

**Variable:** `ENABLE_V3_PNL_VIEWS`
**Default:** `false` (not set = V2 active)
**Location:** `.env.local` (git-ignored)

### How to Enable V3

Add to `.env.local`:

```bash
# Enable V3 PnL views (69% coverage vs V2's 10%)
ENABLE_V3_PNL_VIEWS=true
```

Then restart the Next.js server:

```bash
npm run dev  # Development
# or
pm2 restart cascadian  # Production
```

### How to Disable V3 (Rollback)

**Option 1: Remove the flag**

```bash
# Remove or comment out in .env.local
# ENABLE_V3_PNL_VIEWS=true
```

**Option 2: Set to false**

```bash
ENABLE_V3_PNL_VIEWS=false
```

Then restart the server (instant rollback).

---

## Using the Feature Flag in Code

### Example: API Route

```typescript
import { getPnLViewName } from '@/lib/clickhouse/pnl-views';
import { clickhouse } from '@/lib/clickhouse/client';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get('wallet');

  // Automatically selects V2 or V3 based on env var
  const pnlView = getPnLViewName();

  const query = `
    SELECT
      wallet_address,
      realized_pnl_usd,
      total_trades,
      canonical_condition_source  -- Only exists in V3
    FROM ${pnlView}
    WHERE wallet_address = {wallet:String}
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet: walletAddress },
    format: 'JSONEachRow',
  });

  return Response.json(await result.json());
}
```

### Helper Functions Available

**File:** `lib/clickhouse/pnl-views.ts`

```typescript
import {
  getPnLViewName,           // Returns 'pm_wallet_market_pnl_v2' or 'vw_wallet_market_pnl_v3'
  getPnLTradeSourceName,    // Returns 'pm_trades_canonical_v2' or 'vw_trades_canonical_current'
  isV3PnLEnabled,           // Returns true/false
  getPnLVersion,            // Returns 'v2' or 'v3'
} from '@/lib/clickhouse/pnl-views';
```

---

## Daily Monitoring

### Script Location

`scripts/monitor-v3-daily-diff.ts`

### What It Does

- Compares V2 vs V3 PnL for last 7 days
- Checks position count delta
- Checks realized PnL delta
- Alerts if delta > 10% or absolute PnL delta > $100k
- Writes daily report to `/tmp/v3_daily_monitoring_{date}.txt`

### Running Manually

```bash
npx tsx scripts/monitor-v3-daily-diff.ts
```

### Expected Output

```
═══════════════════════════════════════════════════════════════════════════════
V3 Daily Monitoring - V2 vs V3 PnL Comparison
═══════════════════════════════════════════════════════════════════════════════
Date: 2025-11-16 (PST)

Comparing V2 vs V3 for last 7 days...

═══════════════════════════════════════════════════════════════════════════════
DAILY COMPARISON RESULTS
═══════════════════════════════════════════════════════════════════════════════

Date          V2 Pos    V3 Pos    Delta    Delta%    V2 PnL        V3 PnL        Delta     Alert
────────────────────────────────────────────────────────────────────────────────────────────────
2025-11-10       823     1,712      889    +108.0%    $1,234.56     $2,456.78    $1,222.22  ✅
2025-11-11       945     1,891      946    +100.1%    $-456.78      $123.45      $580.23    ✅
...

═══════════════════════════════════════════════════════════════════════════════
7-DAY SUMMARY
═══════════════════════════════════════════════════════════════════════════════

Total V2 Positions: 6,305
Total V3 Positions: 13,049
Position Improvement: +6,744

Alert Count: 0 / 7 days
Status: ✅ ALL CLEAR
```

### Cron Schedule (Recommended)

Add to crontab for daily midnight PST monitoring:

```bash
# Daily V3 monitoring at midnight PST
0 0 * * * cd /path/to/Cascadian-app && npx tsx scripts/monitor-v3-daily-diff.ts
```

---

## Rollback Scenarios

### Scenario 1: Proactive Rollback (Before Issues)

**Trigger:** Daily monitoring shows concerning trends

**Steps:**
1. Set `ENABLE_V3_PNL_VIEWS=false` in `.env.local`
2. Restart Next.js server
3. Verify V2 is active (check logs for `[PnL View] Using V2`)
4. Monitor for 24 hours

**Downtime:** Zero (instant switch)

---

### Scenario 2: Emergency Rollback (During Issues)

**Trigger:** Production errors, user complaints, data anomalies

**Steps:**
1. **Immediate:** Comment out `ENABLE_V3_PNL_VIEWS` in `.env.local`
2. **Restart:** `pm2 restart cascadian` or `npm run dev`
3. **Verify:** Check next API request uses V2
4. **Investigate:** Review logs, compare V2 vs V3 outputs

**Downtime:** ~10 seconds (server restart)

---

### Scenario 3: Partial Rollback (Route-Specific)

**Trigger:** One route has issues, others are fine

**Steps:**
1. Modify specific API route to hardcode V2:

```typescript
// Temporary override for this route only
const pnlView = 'pm_wallet_market_pnl_v2';  // Force V2
```

2. Deploy route-specific fix
3. Keep feature flag ON for other routes
4. Investigate and fix broken route

**Downtime:** Zero (surgical fix)

---

## Validation Checklist (Before GO Decision)

### Daily Monitoring (7+ Days)

- [ ] No alerts in last 7 days
- [ ] Position delta consistently positive (V3 >= V2)
- [ ] PnL delta < $100k for all days
- [ ] Zero regression reports

### Manual Testing

- [ ] Wallet detail pages load correctly
- [ ] PnL values match expectations
- [ ] Leaderboard rankings look reasonable
- [ ] No console errors in browser
- [ ] API response times acceptable

### Data Quality

- [ ] V3 shows 3x more positions than V2
- [ ] canonical_condition_source = 'v3' for 99%+ positions
- [ ] Realized PnL formulas match V2 exactly
- [ ] No unexplained PnL deltas for known wallets

### Rollback Readiness

- [ ] V2 tables/views intact and queryable
- [ ] Feature flag tested (ON → OFF → ON)
- [ ] Team knows how to rollback
- [ ] Monitoring alerts configured

---

## Production Rollout Timeline (Suggested)

### Week 1: Internal Testing

- Enable V3 for internal dashboards only
- Run daily monitoring
- Collect feedback from team

### Week 2: Beta Testing

- Enable V3 for beta users (feature flag in DB)
- Compare user reports to V2 baseline
- Fix any issues discovered

### Week 3: Gradual Rollout

- Monday: 10% of users
- Wednesday: 25% of users
- Friday: 50% of users

### Week 4: Full Rollout

- Monday: 100% of users
- Monitor closely for 48 hours
- Mark V2 as deprecated (but keep active for 30 days)

---

## Known Issues

### xcnstrategy Trade Count Discrepancy

**Issue:** pm_trades_canonical_v3 is missing 604 trades for wallet `xcnstrategy`

**Details:**
- **pm_trades_canonical_v3:** 780 trades
- **vw_trades_canonical / wallet_metrics_complete:** 1,384-1,385 trades
- **Gap:** 604 missing trades (~43.6%)

**Status:** Under investigation by C2 (Data Pipeline Agent) and C3 (Validation Agent)

**Impact:**
- ✅ **Relative analytics:** V3 is safe for position trend analysis and leaderboard rankings
- ⚠️ **Absolute PnL:** Some wallets may show inaccurate total PnL values until V4 data quality fixes are applied

**Mitigation:**
- Keep `ENABLE_V3_PNL_VIEWS=false` (default OFF) for external users
- Wait for C3 to resolve discrepancy and C2 to deliver V4 prototype
- Internal testing only until data quality issues are resolved

**Timeline:**
- V4 investigation in progress by C2
- Expected coverage improvement: 85-90% (vs 69% in V3)
- No ETA for production rollout until investigation complete

---

## What NOT to Do

❌ **Do NOT** drop or modify V2 tables (`pm_wallet_market_pnl_v2`, `pm_trades_canonical_v2`)
❌ **Do NOT** change V3 schema/logic after validation
❌ **Do NOT** switch production default without 7+ days of clean monitoring
❌ **Do NOT** skip rollback testing
❌ **Do NOT** enable V3 globally without gradual rollout

---

## Monitoring Commands

### Check Current Version

```bash
# Look for log line on next API request
tail -f logs/app.log | grep "PnL View"

# Should see either:
# [PnL View] Using V2: pm_wallet_market_pnl_v2 (default)
# [PnL View] Using V3: vw_wallet_market_pnl_v3
```

### Quick V2 vs V3 Comparison

```bash
npx tsx scripts/compare-v2-v3-pnl.ts
```

### Daily Monitoring

```bash
npx tsx scripts/monitor-v3-daily-diff.ts
cat /tmp/v3_daily_monitoring_$(date +%Y-%m-%d).txt
```

---

## Support Contacts

**Questions about rollout:** C1 (Database Agent)
**Production issues:** DevOps team
**Data quality concerns:** Analytics team

---

## Change Log

| Date | Change | By |
|------|--------|-----|
| 2025-11-16 | Infrastructure created, feature flag OFF | C1 |
| TBD | First internal test | TBD |
| TBD | Production rollout decision | TBD |

---

**Status:** Infrastructure ready. V2 active. Awaiting GO decision for gradual V3 rollout.

**Prepared by:** C1 (PST)
**Last Updated:** 2025-11-16
