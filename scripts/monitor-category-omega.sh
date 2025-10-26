#!/bin/bash
# Monitor category omega calculation progress

echo "📊 Category Omega Calculation - Live Progress"
echo "=============================================="
echo ""

# Check if running
if ! ps aux | grep -v grep | grep "calculate-category-omega" > /dev/null; then
    echo "❌ Script is not running"
    echo ""
    echo "Recent output:"
    tail -30 /tmp/category-omega-fixed.log
    exit 1
fi

echo "✅ Script is running in background"
echo ""

# Show progress
echo "Recent progress:"
echo "----------------------------------------"
tail -40 /tmp/category-omega-fixed.log | grep -E "^\[|Resolving|Resolved|Saved|categories:|SUMMARY"

echo ""
echo "----------------------------------------"
echo "💡 Refresh this every 30 seconds with:"
echo "   bash scripts/monitor-category-omega.sh"
echo ""
echo "📝 Full log: /tmp/category-omega-fixed.log"
