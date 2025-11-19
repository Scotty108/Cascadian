#!/bin/bash
# ============================================================================
# Install Nightly Collision Monitoring Cron Job
# Purpose: Sets up automated daily monitoring for pm_trades_canonical_v3
# ============================================================================

set -e

PROJECT_DIR="/Users/scotty/Projects/Cascadian-app"
CRON_SCRIPT="$PROJECT_DIR/scripts/nightly-collision-check.ts"
LOG_DIR="$PROJECT_DIR/logs/monitoring"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🛡️  Installing Nightly Collision Monitoring Cron Job..."
echo ""

# Step 1: Verify script exists
if [ ! -f "$CRON_SCRIPT" ]; then
  echo -e "${RED}❌ Error: Monitoring script not found at $CRON_SCRIPT${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Monitoring script found${NC}"

# Step 2: Create log directory
mkdir -p "$LOG_DIR"
echo -e "${GREEN}✅ Log directory created: $LOG_DIR${NC}"

# Step 3: Test the monitoring script
echo ""
echo "Testing monitoring script..."
cd "$PROJECT_DIR"
if npx tsx "$CRON_SCRIPT" 2>&1 | tee "$LOG_DIR/test-run.log"; then
  echo -e "${GREEN}✅ Test run completed successfully${NC}"
else
  echo -e "${RED}❌ Test run failed. Check logs at $LOG_DIR/test-run.log${NC}"
  exit 1
fi

# Step 4: Create cron job entry
CRON_ENTRY="0 1 * * * cd $PROJECT_DIR && npx tsx $CRON_SCRIPT >> $LOG_DIR/nightly-monitor-\$(date +\%Y-\%m-\%d).log 2>&1"

echo ""
echo "Proposed cron entry:"
echo -e "${YELLOW}$CRON_ENTRY${NC}"
echo ""

# Step 5: Check if cron entry already exists
if crontab -l 2>/dev/null | grep -q "nightly-collision-check.ts"; then
  echo -e "${YELLOW}⚠️  Cron job already installed. Skipping.${NC}"
  echo "To reinstall, first remove with: crontab -e"
else
  # Backup existing crontab
  echo "Backing up current crontab..."
  crontab -l > "$LOG_DIR/crontab-backup-$(date +%Y%m%d-%H%M%S).txt" 2>/dev/null || true

  # Install new cron entry
  echo "Installing cron job..."
  (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
  echo -e "${GREEN}✅ Cron job installed${NC}"
fi

# Step 6: Verify installation
echo ""
echo "Current crontab:"
crontab -l | grep -A 1 -B 1 "nightly-collision-check" || echo "(no matching entries)"

echo ""
echo "============================================================================"
echo -e "${GREEN}✅ INSTALLATION COMPLETE${NC}"
echo "============================================================================"
echo ""
echo "Monitoring will run daily at 1:00 AM PST"
echo "Logs: $LOG_DIR/nightly-monitor-YYYY-MM-DD.log"
echo ""
echo "Manual run: npx tsx $CRON_SCRIPT"
echo "View logs: tail -f $LOG_DIR/nightly-monitor-*.log"
echo "Remove cron: crontab -e (then delete the nightly-collision-check line)"
echo ""
echo "============================================================================"
