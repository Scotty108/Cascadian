# Overnight Tasks Running (2025-11-15)

**Started:** 2025-11-15 01:33 AM PST  
**Purpose:** Prepare data and benchmarks for tomorrow's AMM coverage implementation  
**Status:** Running in background  

---

## What's Running Overnight

### Script: `scripts/overnight-preparation.ts`
**Output Files:**
- `tmp/overnight-analysis.log` - Live progress log
- `tmp/overnight-analysis.json` - Complete results (saved incrementally)

**Monitor Progress:**
```bash
# Watch live progress
tail -f tmp/overnight-analysis.log

# Check results so far
cat tmp/overnight-analysis.json | jq '.analyses[] | {name, success, duration_ms}'
```

---

## Analyses Being Performed

### 1. Full Coverage Analysis
**Purpose:** Calculate exact coverage across ALL 149,908 markets  
**Query:** Checks CLOB + ERC1155 + token mapping for every market  
**Output:**
- Total CLOB markets
- AMM-only markets (critical for testing!)
- Zero-trade markets
- Overall coverage percentage

**Why Important:** Gives us the real numbers instead of estimates

---

### 2. AMM-Only Test Markets
**Purpose:** Find up to 20 markets that have ERC1155 activity but NO CLOB fills  
**Sorted by:** Transfer count (highest first)  
**Output:** List of condition IDs + transfer counts

**Why Important:** These are our test cases for tomorrow! We need real AMM-only markets to validate the hybrid implementation.

---

### 3. High-Volume CLOB Markets
**Purpose:** Find the 10 highest-volume CLOB markets  
**Output:**
- Fill counts
- Unique traders
- Date ranges

**Why Important:** Performance baseline - if ERC1155 queries are slower than CLOB, we'll know by how much

---

### 4. Token Mapping Coverage by Month
**Purpose:** See if mapping coverage has degraded over time  
**Output:** Monthly breakdown from Jan 2024 to present  

**Why Important:** If recent months have worse coverage, we need to know before implementation

---

### 5. ERC1155 Volume Distribution
**Purpose:** Categorize markets by transfer volume  
**Categories:**
- Zero transfers
- Low (1-10)
- Medium (11-100)
- High (101-1000)
- Very high (1000+)

**Why Important:** Helps set performance expectations and caching strategies

---

### 6. Recent Markets Coverage
**Purpose:** Last 30 days of market creation with coverage stats  
**Output:** Daily breakdown of CLOB vs mapping coverage

**Why Important:** Shows if there's a recent degradation in data quality

---

### 7. Sample ERC1155 Query Performance
**Purpose:** Run actual ERC1155 queries on 5 random markets  
**Measures:** Query duration for transfer lookups

**Why Important:** Real performance data to set optimization targets

---

## Expected Runtime

**Estimated Total Time:** 30-90 minutes  
**Depends on:**
- Full coverage analysis (slowest - might take 20-40 minutes)
- Database load
- Network latency

**Progress Saves:** Results are saved after each analysis, so if it fails mid-way, we won't lose everything.

---

## What You'll Have Tomorrow Morning

When you wake up, you'll have:

1. **Exact coverage numbers** - Not estimates, real data
2. **AMM-only test markets** - Real markets to test hybrid approach
3. **Performance benchmarks** - Query speeds to optimize against
4. **Coverage trends** - Whether data quality is stable or degrading
5. **Volume distribution** - How markets are distributed by activity

All saved in `tmp/overnight-analysis.json` for easy reference.

---

## How to Use Results Tomorrow

```bash
# Quick summary
cat tmp/overnight-analysis.json | jq '.analyses[] | select(.name == "Full Coverage Analysis") | .data[]'

# Get AMM-only markets
cat tmp/overnight-analysis.json | jq '.analyses[] | select(.name == "AMM-Only Test Markets") | .data[]'

# Check performance
cat tmp/overnight-analysis.json | jq '.analyses[] | select(.name | contains("Performance")) | {name, duration_ms}'

# Pretty print everything
cat tmp/overnight-analysis.json | jq '.'
```

---

## If Something Goes Wrong

**Script Crashes:**
- Check `tmp/overnight-analysis.log` for error
- Results saved incrementally in `tmp/overnight-analysis.json`
- Can manually re-run: `npx tsx scripts/overnight-preparation.ts`

**Script Still Running in Morning:**
- Let it finish (might be on the slowest query)
- Or kill it and use partial results: `pkill -f overnight-preparation`

**No Results File:**
- Script might have failed immediately
- Check: `cat tmp/overnight-analysis.log`

---

## Background Processes Status

You also have these background processes still running from earlier:

```bash
# Check all background processes
ps aux | grep tsx

# Kill specific ones if needed
pkill -f diagnose-missing-clob-markets
pkill -f backfill-missing-clob-markets
```

---

## Tomorrow's Checklist

When you start tomorrow:

- [ ] Check `tmp/overnight-analysis.json` exists
- [ ] Review coverage numbers
- [ ] Identify AMM-only test markets
- [ ] Note performance benchmarks
- [ ] Read action plan: `docs/operations/AMM_COVERAGE_ACTION_PLAN.md`
- [ ] Read quick ref: `docs/operations/AMM_QUICK_REFERENCE.md`
- [ ] Start implementation!

---

**Good night! Everything will be ready tomorrow.**

**— Claude 1** 🤖
