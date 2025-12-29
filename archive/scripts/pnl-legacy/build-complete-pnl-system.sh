#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════════
# COMPLETE P&L SYSTEM BUILD SCRIPT
# ═══════════════════════════════════════════════════════════════════════════════
# This script builds the complete 3-phase P&L calculation system:
#   Phase 1: Trading P&L (entry/exit spread)
#   Phase 2: Unrealized P&L (mark-to-market)
#   Phase 3: Unified P&L (combining all sources)
# ═══════════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "BUILDING COMPLETE P&L SYSTEM"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

# Load environment
source .env.local 2>/dev/null || true

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 1: Trading P&L (Average Cost Method - SQL)
# ───────────────────────────────────────────────────────────────────────────────

echo "Phase 1: Creating Trading P&L views (average cost method)..."
echo ""

clickhouse-client \
  --host="${CLICKHOUSE_HOST#http://}" \
  --user="$CLICKHOUSE_USER" \
  --password="$CLICKHOUSE_PASSWORD" \
  --multiquery < phase1-sql-views.sql

echo "✓ Phase 1 SQL views created"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 1B: Trading P&L (FIFO Method - TypeScript)
# ───────────────────────────────────────────────────────────────────────────────

echo "Phase 1B: Running FIFO P&L matcher (this may take 5-15 minutes)..."
echo ""

npx tsx phase1b-fifo-pnl.ts

echo "✓ Phase 1B FIFO matching complete"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 2: Unrealized P&L Views
# ───────────────────────────────────────────────────────────────────────────────

echo "Phase 2: Creating Unrealized P&L views..."
echo ""

clickhouse-client \
  --host="${CLICKHOUSE_HOST#http://}" \
  --user="$CLICKHOUSE_USER" \
  --password="$CLICKHOUSE_PASSWORD" \
  --multiquery < phase2-unrealized-pnl.sql

echo "✓ Phase 2 SQL views created"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 2: Fetch Current Midprices
# ───────────────────────────────────────────────────────────────────────────────

echo "Phase 2: Fetching current midprices from Polymarket CLOB..."
echo ""

npx tsx phase2-refresh-midprices.ts

echo "✓ Phase 2 midprices refreshed"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# PHASE 3: Unified P&L View
# ───────────────────────────────────────────────────────────────────────────────

echo "Phase 3: Creating unified P&L views..."
echo ""

clickhouse-client \
  --host="${CLICKHOUSE_HOST#http://}" \
  --user="$CLICKHOUSE_USER" \
  --password="$CLICKHOUSE_PASSWORD" \
  --multiquery < phase3-unified-pnl.sql

echo "✓ Phase 3 unified views created"
echo ""

# ───────────────────────────────────────────────────────────────────────────────
# VALIDATION
# ───────────────────────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "RUNNING VALIDATION"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

npx tsx validate-pnl-vs-polymarket.ts

# ───────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ───────────────────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "BUILD COMPLETE"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""
echo "✅ Phase 1: Trading P&L (average cost + FIFO)"
echo "✅ Phase 2: Unrealized P&L (mark-to-market)"
echo "✅ Phase 3: Unified P&L views"
echo "✅ Validation against test wallets"
echo ""
echo "AVAILABLE VIEWS:"
echo "  • cascadian_clean.vw_wallet_pnl_unified     - Complete wallet P&L breakdown"
echo "  • cascadian_clean.vw_wallet_pnl_closed      - Closed P&L only (Polymarket 'Closed' tab)"
echo "  • cascadian_clean.vw_wallet_pnl_all         - All P&L including unrealized (Polymarket 'All' tab)"
echo "  • cascadian_clean.vw_market_pnl_unified     - Per-market P&L breakdown"
echo "  • cascadian_clean.vw_pnl_coverage_metrics   - System coverage and health metrics"
echo ""
echo "MAINTENANCE:"
echo "  • Run 'npx tsx phase2-refresh-midprices.ts' every 2-5 minutes (cron)"
echo "  • Check coverage metrics daily"
echo "  • Re-run FIFO matcher after major data imports"
echo ""
echo "NEXT STEPS:"
echo "  1. Point UI to vw_wallet_pnl_unified"
echo "  2. Compare results with Polymarket for test wallets"
echo "  3. Set up cron job for midprice refresh"
echo ""
