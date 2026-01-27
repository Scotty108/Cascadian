#!/bin/bash
# Phase 3: Migrate All Queries to Use Deduplicated Views
#
# Systematically updates all queries to use _deduped materialized views.
# This is a global find/replace operation.
#
# Duration: 5 minutes

set -e

echo "🔄 Migrating Queries to Deduplicated Views"
echo ""

# Count files to be updated
echo "Scanning for files to update..."
FILES_CANONICAL=$(grep -r "FROM pm_canonical_fills_v4" --include="*.ts" --include="*.tsx" app/ lib/ scripts/ | grep -v "_deduped" | wc -l | tr -d ' ')
FILES_FIFO=$(grep -r "FROM pm_trade_fifo_roi_v3" --include="*.ts" --include="*.tsx" app/ lib/ scripts/ | grep -v "_deduped" | wc -l | tr -d ' ')
FILES_EVENTS=$(grep -r "FROM pm_trader_events_v2" --include="*.ts" --include="*.tsx" app/ lib/ scripts/ | grep -v "_deduped" | wc -l | tr -d ' ')

echo "Files to update:"
echo "  - pm_canonical_fills_v4: $FILES_CANONICAL files"
echo "  - pm_trade_fifo_roi_v3: $FILES_FIFO files"
echo "  - pm_trader_events_v2: $FILES_EVENTS files"
echo ""

# Backup before changes
echo "Creating backup branch..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_BRANCH="backup/pre-dedup-migration-${TIMESTAMP}"
git checkout -b "${BACKUP_BRANCH}" 2>/dev/null || echo "Already on a branch"
git add -A
git commit -m "backup: pre-dedup migration snapshot ${TIMESTAMP}" || echo "No changes to commit"
git checkout main

echo "✓ Backup created: ${BACKUP_BRANCH}"
echo ""

# Step 1: Update pm_canonical_fills_v4 references
echo "Step 1: Updating pm_canonical_fills_v4 → pm_canonical_fills_v4_deduped..."
find app/ lib/ scripts/ -type f \( -name "*.ts" -o -name "*.tsx" \) -exec \
  perl -i -pe 's/FROM pm_canonical_fills_v4(?!_deduped)/FROM pm_canonical_fills_v4_deduped/g' {} +
find app/ lib/ scripts/ -type f \( -name "*.ts" -o -name "*.tsx" \) -exec \
  perl -i -pe 's/JOIN pm_canonical_fills_v4(?!_deduped)/JOIN pm_canonical_fills_v4_deduped/g' {} +
echo "✓ Updated $FILES_CANONICAL references"
echo ""

# Step 2: Update pm_trade_fifo_roi_v3 references
echo "Step 2: Updating pm_trade_fifo_roi_v3 → pm_trade_fifo_roi_v3_deduped..."
find app/ lib/ scripts/ -type f \( -name "*.ts" -o -name "*.tsx" \) -exec \
  perl -i -pe 's/FROM pm_trade_fifo_roi_v3(?!_deduped)/FROM pm_trade_fifo_roi_v3_deduped/g' {} +
find app/ lib/ scripts/ -type f \( -name "*.ts" -o -name "*.tsx" \) -exec \
  perl -i -pe 's/JOIN pm_trade_fifo_roi_v3(?!_deduped)/JOIN pm_trade_fifo_roi_v3_deduped/g' {} +
echo "✓ Updated $FILES_FIFO references"
echo ""

# Step 3: Update pm_trader_events_v2 references
echo "Step 3: Updating pm_trader_events_v2 → pm_trader_events_v2_deduped..."
find app/ lib/ scripts/ -type f \( -name "*.ts" -o -name "*.tsx" \) -exec \
  perl -i -pe 's/FROM pm_trader_events_v2(?!_deduped)/FROM pm_trader_events_v2_deduped/g' {} +
find app/ lib/ scripts/ -type f \( -name "*.ts" -o -name "*.tsx" \) -exec \
  perl -i -pe 's/JOIN pm_trader_events_v2(?!_deduped)/JOIN pm_trader_events_v2_deduped/g' {} +
echo "✓ Updated $FILES_EVENTS references"
echo ""

# Step 4: Remove GROUP BY fill_id CTEs (no longer needed)
echo "Step 4: Removing unnecessary GROUP BY CTEs..."
echo "(This is safe because views handle deduplication now)"
# Note: This requires manual review - commenting out for safety
# find app/api -type f -name "*.ts" -exec sed -i '' '/GROUP BY fill_id/d' {} +
echo "⚠️  Manual step: Review and remove GROUP BY fill_id/event_id CTEs"
echo ""

# Step 5: Show what changed
echo "════════════════════════════════════════════════════"
echo "✅ Query Migration Complete!"
echo "════════════════════════════════════════════════════"
echo ""
echo "Files modified: $(git diff --name-only | wc -l | tr -d ' ')"
echo ""
echo "Review changes:"
echo "  git diff"
echo ""
echo "If satisfied:"
echo "  git add -A"
echo "  git commit -m 'refactor: migrate all queries to deduplicated views'"
echo "  git push"
echo ""
echo "If issues found:"
echo "  git checkout ${BACKUP_BRANCH}"
echo ""
echo "Next step: Deploy and monitor, then run 04-create-monitoring.ts"
echo ""
