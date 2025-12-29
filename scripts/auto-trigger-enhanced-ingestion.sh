#!/bin/bash
#
# Auto-Trigger Enhanced Ingestion
#
# Monitors the current token_ids ingestion (d100a5) and automatically
# triggers the enhanced series tag ingestion when it completes.
#
# Created: 2025-11-19
# Purpose: Boost tag coverage from 2% to 50%+ via series title extraction
#

LOG_FILE="/tmp/auto-trigger-enhanced.log"
CURRENT_INGESTION_LOG="/tmp/token-ids-production.log"
ENHANCED_INGESTION_LOG="/tmp/enhanced-tags-ingestion.log"

echo "======================================================================" | tee -a "$LOG_FILE"
echo "🤖 AUTO-TRIGGER: Enhanced Ingestion Monitor" | tee -a "$LOG_FILE"
echo "======================================================================" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Step 1: Monitor current ingestion
echo "📡 Monitoring current ingestion..." | tee -a "$LOG_FILE"
echo "   Log: $CURRENT_INGESTION_LOG" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

while true; do
  # Check if the process is still running
  if pgrep -f "ingest-market-metadata.ts" > /dev/null; then
    # Get current progress from log
    PROGRESS=$(tail -1 "$CURRENT_INGESTION_LOG" 2>/dev/null | grep -oE '[0-9]+ markets')
    if [ -n "$PROGRESS" ]; then
      echo "   [$(date +%H:%M:%S)] Current: $PROGRESS" | tee -a "$LOG_FILE"
    fi
    sleep 30
  else
    echo "" | tee -a "$LOG_FILE"
    echo "✅ Current ingestion completed at $(date)" | tee -a "$LOG_FILE"
    break
  fi
done

# Step 2: Wait a bit to ensure clean completion
echo "" | tee -a "$LOG_FILE"
echo "⏳ Waiting 10 seconds for clean shutdown..." | tee -a "$LOG_FILE"
sleep 10

# Step 3: Trigger enhanced ingestion
echo "" | tee -a "$LOG_FILE"
echo "======================================================================" | tee -a "$LOG_FILE"
echo "🚀 STARTING ENHANCED INGESTION (with series tags)" | tee -a "$LOG_FILE"
echo "======================================================================" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Log: $ENHANCED_INGESTION_LOG" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Expected Improvements:" | tee -a "$LOG_FILE"
echo "  - Series titles extracted (NBA, UFC, NFL, etc.)" | tee -a "$LOG_FILE"
echo "  - Tag coverage: 2% → 50%+" | tee -a "$LOG_FILE"
echo "  - token_ids already fixed from previous run" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Run the enhanced ingestion
cd /Users/scotty/Projects/Cascadian-app
npx tsx scripts/ingest-market-metadata.ts 2>&1 | tee "$ENHANCED_INGESTION_LOG" | tee -a "$LOG_FILE"

# Step 4: Report completion
echo "" | tee -a "$LOG_FILE"
echo "======================================================================" | tee -a "$LOG_FILE"
echo "✅ ENHANCED INGESTION COMPLETE" | tee -a "$LOG_FILE"
echo "======================================================================" | tee -a "$LOG_FILE"
echo "Completed: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Quick validation
echo "📊 Quick Validation:" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Check tag coverage with:" | tee -a "$LOG_FILE"
echo "  SELECT" | tee -a "$LOG_FILE"
echo "    count() as total," | tee -a "$LOG_FILE"
echo "    countIf(length(tags) > 0) as with_tags," | tee -a "$LOG_FILE"
echo "    round(countIf(length(tags) > 0) / count() * 100, 1) as coverage_pct" | tee -a "$LOG_FILE"
echo "  FROM pm_market_metadata" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
