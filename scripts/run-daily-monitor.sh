#!/bin/bash

# Daily Table Swap Monitor
# Run this once per day to track table health and detect drift

echo "=================================================="
echo "Daily Table Swap Monitor - $(date)"
echo "=================================================="
echo ""

# Run the TypeScript monitoring script
npx tsx monitor-table-swap-daily.ts

EXIT_CODE=$?

echo ""
echo "=================================================="
echo "Monitor completed: $(date)"
echo "Exit code: $EXIT_CODE"
echo ""

if [ $EXIT_CODE -eq 0 ]; then
  echo "✅ Status: STABLE"
else
  echo "❌ Status: DRIFT DETECTED - Check output above"
fi

echo "=================================================="

exit $EXIT_CODE
