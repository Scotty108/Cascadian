#!/bin/bash
# Monitor backfill progress every 5 minutes

while true; do
  echo "=== $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
  tail -5 /private/tmp/claude/-Users-scotty-Projects-Cascadian-app/tasks/b97c6ea.output
  echo ""
  sleep 300
done
