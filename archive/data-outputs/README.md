# Data Outputs Archive

This folder contains generated data files, checkpoints, and snapshots from analysis runs and backfill operations.

## Categories

### Checkpoint Results
**12 CSV files | Progress snapshots from backfill operations**

Records of backfill checkpoints and analysis results.
- `checkpoint_a_results.csv` - Track A checkpoint
- `daily_pnl_series.csv` - Daily P&L series
- Progress tracking from parallel worker operations

### Snapshots
**26 JSON files | Data state snapshots from investigations**

Point-in-time snapshots of wallet states, configurations, and analysis results.
- Wallet identity maps
- ID format analysis results
- Control wallet summaries
- Collision detection results
- Configuration snapshots

### API Responses
**0-1 files | Sample API responses**

Example responses from external APIs for reference.

---

## What These Files Contain

### Checkpoint Files
Generated during backfill operations to track progress across parallel workers.
- **Purpose:** Resume backfill on failure, track completion status
- **Usage:** Already used during backfill - safe to archive
- **Safety:** Non-critical - can be recreated if needed

### Snapshot Files
JSON exports of data states at specific points in investigation.
- **Purpose:** Track analysis results, test fixture generation
- **Usage:** Reference for understanding analysis outcomes
- **Safety:** Recreatable from database queries

### API Response Files
Sample responses from external APIs (Polymarket, Goldsky, etc.)
- **Purpose:** Reference for API schema
- **Usage:** Documentation, testing
- **Safety:** Reproducible by calling API

---

## Using These Files

### For Understanding System State
Review snapshots to see what data looked like at specific investigation points:
```json
// Example: control_wallet_summary.json
{
  "wallet_address": "0x...",
  "trade_count": 142,
  "pnl": 15234.56,
  "timestamp": "2025-11-12T08:30:00Z"
}
```

### For Validation
Compare current data with archived snapshots to verify consistency:
```bash
# Check if wallet data matches archived snapshot
jq .trade_count control_wallet_summary.json
```

### For Testing
Use fixtures and snapshots as reference data for test cases.

---

## Statistics

| Type | Count | Size | Purpose |
|------|-------|------|---------|
| Checkpoint CSV | 12 | ~5 MB | Backfill progress |
| Snapshots JSON | 26 | ~300 MB | Analysis results |
| API Responses | 0-1 | <1 MB | Reference |
| **TOTAL** | **38+** | **~305 MB** | - |

---

## Important Notes

⚠️ **These are point-in-time snapshots:**
- Data is not current
- Use archive for reference only
- Don't use for active decisions
- Always verify against live data

✅ **Safe to:**
- Reference for understanding past state
- Use as test fixtures (with care)
- Compare against current data

❌ **Don't:**
- Assume data accuracy
- Use for production queries
- Rely on for business logic

---

## Related Documentation

- **Investigation Reports:** `archive/investigation-reports/` (context for snapshots)
- **Diagnostic Scripts:** `archive/diagnostic-scripts/` (tools that generated these)
- **Archive Index:** `archive/MASTER-INDEX.md` (search all archives)

---

**Archive Created:** November 18, 2025
**Total Files:** 38+
**Total Size:** ~305 MB

