# Overnight Pipeline Run Instructions 🌙

**Date:** October 25, 2025
**Estimated Runtime:** 3-5 hours
**Method:** Caffeinate (prevents Mac sleep)

---

## ⏰ Before You Go to Bed

### Step 1: Wait for Discovery to Finish
**Current Status:** Check with:
```bash
tail -f /tmp/wallet-discovery-v2.log
```

**Look for:** "✅ All wallets saved to `discovered_wallets` table"

**ETA:** Discovery should finish within 20-30 minutes

---

### Step 2: Start the Pipeline
**When discovery shows "COMPLETE", run:**

```bash
caffeinate -i npx tsx scripts/run-full-pipeline.ts
```

**What `caffeinate` does:**
- Prevents your Mac from sleeping
- Keeps the process running all night
- Automatically stops when pipeline completes

**Important:** Keep your Mac **plugged in** to power!

---

### Step 3: Verify It's Running

You should see:
```
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        🚀 TSI DATA PIPELINE ORCHESTRATOR 🚀              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

📋 PIPELINE STEPS:

1. Bulk Sync Wallet Trades
   Script: scripts/sync-all-wallets-bulk.ts
   Estimated: 2-4 hours

2. Enrich Trades with P&L
   Script: scripts/enrich-trades.ts
   Estimated: 30-60 minutes

3. Calculate Tier 1 Metrics
   Script: scripts/calculate-tier1-metrics.ts
   Estimated: 2-5 minutes

⏱️  Total Estimated Time: 3-5 hours
```

---

### Step 4: Go to Sleep! 😴

The pipeline will:
- ✅ Run all 3 steps automatically
- ✅ Show progress in terminal
- ✅ Save final summary when complete
- ✅ Exit when done (Mac can sleep after)

---

## ☀️ In the Morning

### Check Pipeline Status

**Option 1 - Terminal Output:**
The terminal will show final summary:
```
═══════════════════════════════════════════════════════════
           📊 PIPELINE EXECUTION SUMMARY 📊
═══════════════════════════════════════════════════════════

1. ✅ Bulk Sync Wallet Trades
   Time: 187.3 minutes

2. ✅ Enrich Trades with P&L
   Time: 42.1 minutes

3. ✅ Calculate Tier 1 Metrics
   Time: 3.2 minutes

═══════════════════════════════════════════════════════════
✅ Successful: 3/3
❌ Failed: 0/3
⏱️  Total Time: 232.6 minutes (3.88 hours)
═══════════════════════════════════════════════════════════

🎉 PIPELINE COMPLETED SUCCESSFULLY! 🎉
```

**Option 2 - Admin Dashboard:**
Visit: `http://localhost:3000/admin/pipeline`

You should see:
- **ClickHouse Tables:** All showing thousands/millions of rows
- **Total Wallets:** ~60,000
- **Synced Wallets:** ~60,000 (100%)
- **Data Quality:**
  - Enrichment Rate: ~100%
  - Metrics Coverage: ~100%
- **Pipeline Status:** "Complete"

---

## 🎯 Test Real Data

### 1. Visit Demo Pages
All should now show **REAL DATA**:
- `http://localhost:3000/demo/tsi-signals`
- `http://localhost:3000/demo/top-wallets`
- `http://localhost:3000/demo/category-leaderboard`

### 2. Visit Production Pages
- **Market Detail:** Any market should show TSI Signal Card with real data
- **Market Insights:** Category Leaderboard should show real categories
- **Whale Activity → Scoreboard:** Top Wallets Table should show real traders

### 3. Check a Market Detail Page
Pick any active market and verify:
- ✅ TSI Signal shows BULLISH/BEARISH/NEUTRAL (not loading)
- ✅ Directional Conviction shows real percentage
- ✅ Elite consensus shows real percentages

---

## 🐛 Troubleshooting

### Pipeline Failed?
**Check the error in terminal output**

Common issues:
- **ClickHouse connection error:** Check `.env.local` credentials
- **Out of memory:** Reduce batch sizes in scripts
- **API rate limits:** Scripts have delays, but may need adjustment

**To retry a specific step:**
```bash
# Retry just the failed step
npx tsx scripts/sync-all-wallets-bulk.ts      # If Step 1 failed
npx tsx scripts/enrich-trades.ts              # If Step 2 failed
npx tsx scripts/calculate-tier1-metrics.ts    # If Step 3 failed
```

### Pipeline Hung/Frozen?
**Check if process is still running:**
```bash
ps aux | grep tsx
```

If hung, kill and restart:
```bash
pkill -f "run-full-pipeline"
caffeinate -i npx tsx scripts/run-full-pipeline.ts
```

### Mac Went to Sleep Anyway?
**Check System Settings:**
- System Settings → Lock Screen → Turn display off: "Never" (while plugged in)
- System Settings → Battery → Prevent automatic sleeping when display is off

---

## 📊 Expected Data Sizes

After pipeline completes, you should have:

| Table | Expected Rows | Purpose |
|-------|--------------|---------|
| `trades_raw` | 2-5 million | Raw wallet trades |
| `trades_enriched` | 2-5 million | Trades with P&L data |
| `wallet_metrics_complete` | ~60,000 | Tier 1 metrics per wallet |
| `market_price_momentum` | ~20,000 | TSI signals per market |

**Total ClickHouse Storage:** ~5-10 GB

---

## 🎉 Success Indicators

You'll know it worked when:

1. ✅ Admin Dashboard shows all tables populated
2. ✅ Demo pages show real trader data (not mock)
3. ✅ Market Detail TSI signals show live momentum
4. ✅ Top Wallets Table shows real Omega scores
5. ✅ Category Leaderboard shows real performance data

---

## 📝 What to Do Next

### Immediate (Morning):
1. ✅ Verify data loaded correctly
2. ✅ Test all demo pages
3. ✅ Check production page integrations

### Short Term (This Week):
1. Set up incremental sync (daily updates)
2. Add monitoring/alerting
3. Optimize pipeline performance if needed

### Long Term:
1. Build more TSI-powered features
2. Add user-facing analytics
3. Implement strategy automation

---

## 🆘 Need Help?

If something goes wrong:
1. Check terminal output for error messages
2. Check `/admin/pipeline` for data status
3. Look at ClickHouse logs (if available)
4. Review `DETAIL_PAGES_AUDIT_REPORT.md` for data requirements

---

**Good luck! See you in the morning with live TSI data! 🌅**
