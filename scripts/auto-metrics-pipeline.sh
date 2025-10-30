#!/bin/bash
# Auto-run metrics after resolution completes

echo "Waiting for resolution script to complete..."
while ps aux | grep -q "[f]ast-apply-resolutions"; do
  sleep 10
done

echo ""
echo "✅ Resolutions complete! Checking results..."
echo ""

# Check resolved counts
npx tsx check-resolved.ts

echo ""
echo "📊 Running overall metrics computation..."
npx tsx scripts/compute-wallet-metrics.ts > runtime/metrics-post-resolution.log 2>&1

echo ""
echo "📊 Running category metrics computation..."
npx tsx scripts/compute-wallet-metrics-by-category.ts > runtime/category-metrics-post-resolution.log 2>&1

echo ""
echo "✅ All metrics computed! Checking final wallet counts..."
npx tsx check-wallet-counts.ts

echo ""
echo "🎉 Pipeline complete!"
