# Data Quality Monitoring Setup

**Created:** November 11, 2025
**Status:** Ready for deployment

---

## 📋 Overview

The monitoring system tracks 3 key data quality metrics:
1. **Resolution Coverage** - % of traded markets with resolution data
2. **Wallet Parity** - Test wallet coverage vs Polymarket
3. **dim_markets Stats** - Metadata completeness

**Files:**
- `monitor-data-quality.ts` - Main monitoring script
- `MONITORING_LOG.json` - Historical metrics log
- `validate-resolution-coverage.ts` - Resolution deep-dive script
- `validate-polymarket-parity.ts` - Wallet comparison script

---

## 🚀 Quick Start

### One-time Run

```bash
npx tsx monitor-data-quality.ts
```

### Continuous Monitoring (5-minute intervals)

```bash
npx tsx monitor-data-quality.ts --continuous --interval=300
```

### Cron Setup (Hourly)

Add to crontab (`crontab -e`):
```bash
0 * * * * cd /path/to/Cascadian-app && npx tsx monitor-data-quality.ts >> logs/monitoring.log 2>&1
```

### Cron Setup (Every 15 minutes)

```bash
*/15 * * * * cd /path/to/Cascadian-app && npx tsx monitor-data-quality.ts >> logs/monitoring.log 2>&1
```

---

## 📊 Metrics Tracked

### Resolution Coverage
- **Total traded markets** - Unique condition_ids in trade_direction_assignments
- **Resolved markets** - Markets in market_resolutions_final
- **Coverage %** - Resolved / Total (expected: 76.3%)
- **Unresolved markets** - Markets still open or awaiting resolution

### Wallet Parity (Test: 0x4ce73141)
- **Polymarket positions** - Expected: 2,816 (from Polymarket UI)
- **Our positions** - Unique markets in our database
- **Coverage %** - Our / Polymarket (expected: 1.1% before ERC1155, 95%+ after)
- **Match quality** - Excellent (95%+), Good (80%+), Fair (50%+), Poor (<50%)

### dim_markets Stats
- **Total markets** - Unique condition_ids in dim_markets (expected: 318K)
- **market_id coverage** - % with market_id (expected: 47.7%)
- **resolved_at coverage** - % with resolved_at timestamp (expected: 42%)
- **category coverage** - % with category (expected: 1.3%)

---

## 🚨 Alert Thresholds

### Default Threshold: 5% drop in coverage

**Alerts trigger when:**
- Resolution coverage drops > 5% from baseline
- Wallet coverage drops > 5% from baseline
- market_id coverage drops > 5% from baseline

**Positive alerts (improvements):**
- Wallet coverage improves > 50% (ERC1155 backfill complete!)

### Status Levels

- **OK** - All metrics within expected range, no alerts
- **DEGRADED** - Coverage dropped but not critical (>5% drop)
- **CRITICAL** - Wallet coverage < 5% OR resolution coverage < 50%

---

## 📈 Expected Timeline

| Event | Resolution Coverage | Wallet Coverage | Status |
|-------|---------------------|-----------------|--------|
| **Current (Nov 11)** | 76.3% | 1.1% | CRITICAL (ERC1155 incomplete) |
| **After ERC1155 backfill** | 76.3% | 95%+ | OK |
| **After unrealized P&L** | 100% (effective) | 95%+ | OK |

---

## 📂 Log Format

`MONITORING_LOG.json` structure:
```json
{
  "runs": [
    {
      "timestamp": "2025-11-11T00:15:00.000Z",
      "resolution_coverage": {
        "total_traded_markets": 206138,
        "resolved_markets": 157319,
        "coverage_pct": 76.3,
        "unresolved_markets": 48819
      },
      "wallet_parity": [
        {
          "wallet_address": "0x4ce73141...",
          "polymarket_positions": 2816,
          "our_positions": 31,
          "coverage_pct": 1.1,
          "match_quality": "❌ Poor"
        }
      ],
      "dim_markets_stats": {
        "total_markets": 318535,
        "with_market_id_pct": 47.7,
        "with_resolved_at_pct": 42.0,
        "with_category_pct": 1.3
      },
      "status": "critical",
      "alerts": []
    }
  ],
  "last_run": "2025-11-11T00:15:00.000Z",
  "baseline": { /* first run used as baseline */ }
}
```

---

## 🔧 Configuration Options

### Command-line Arguments

```bash
--continuous          # Run continuously (default: single run)
--interval=300        # Seconds between runs (default: 300 = 5 minutes)
--alert-threshold=5   # Coverage drop % to trigger alert (default: 5)
```

### Examples

**Test monitoring (single run):**
```bash
npx tsx monitor-data-quality.ts
```

**Development monitoring (1-minute intervals):**
```bash
npx tsx monitor-data-quality.ts --continuous --interval=60
```

**Production monitoring (10-minute intervals, strict alerting):**
```bash
npx tsx monitor-data-quality.ts --continuous --interval=600 --alert-threshold=2
```

---

## 📊 Analyzing Results

### View Current Status

```bash
cat MONITORING_LOG.json | jq '.runs[-1]'
```

### View Coverage Trend

```bash
cat MONITORING_LOG.json | jq '.runs[] | {timestamp, resolution_pct: .resolution_coverage.coverage_pct, wallet_pct: .wallet_parity[0].coverage_pct}'
```

### Count Alerts

```bash
cat MONITORING_LOG.json | jq '[.runs[].alerts | length] | add'
```

### Check for Improvements

```bash
cat MONITORING_LOG.json | jq '.runs[].alerts[] | select(contains("🎉"))'
```

---

## 🎯 Success Criteria

**Resolution Monitoring:**
- ✅ Coverage stays at 76.3% ±2%
- ✅ Unresolved markets decrease over time (as markets close)
- ⚠️  Alert if coverage drops below 70%

**Wallet Parity Monitoring:**
- ✅ Coverage improves from 1.1% to 95%+ after ERC1155 backfill
- ✅ Detects ERC1155 completion automatically
- ⚠️  Alert if coverage drops after reaching 95%+

**dim_markets Monitoring:**
- ✅ market_id coverage stays at 47.7% ±2%
- ✅ resolved_at coverage stays at 42% ±2%
- ⚠️  Alert if any coverage drops significantly

---

## 🔗 Related Files

- **Main scripts:**
  - `monitor-data-quality.ts` - Automated monitoring
  - `validate-resolution-coverage.ts` - Resolution deep-dive
  - `validate-polymarket-parity.ts` - Wallet comparison

- **Documentation:**
  - `BACKFILL_ACTION_CHECKLIST.md` - Overall progress tracking
  - `DIM_MARKETS_METADATA_GAPS.md` - Metadata analysis
  - `MONITORING_LOG.json` - Historical metrics

- **Data tables:**
  - `default.market_resolutions_final` - Resolution data source
  - `default.trade_direction_assignments` - Trade data source
  - `default.dim_markets` - Market metadata source

---

## 🚀 Next Steps

1. ✅ **Run initial baseline** - Done (Nov 11, 2025)
2. ⏳ **Wait for ERC1155 backfill** - Claude 2 in progress
3. ⏳ **Monitor for improvement alert** - Should trigger when wallet coverage jumps to 95%+
4. ⏳ **Validate coverage holds** - After fact_trades rebuild
5. ⏳ **Deploy to production cron** - After validation

---

**Status:** ✅ Ready for deployment
**Last Updated:** November 11, 2025 00:15 UTC
