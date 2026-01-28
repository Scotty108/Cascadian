#!/bin/bash
# Find all API endpoints and scripts that calculate PnL and need closed positions fix

echo "🔍 Finding all files that calculate PnL..."
echo ""

echo "═══════════════════════════════════════════════════════════"
echo "1. Files querying FIFO table (most likely need update)"
echo "═══════════════════════════════════════════════════════════"
grep -r "pm_trade_fifo_roi_v3" app/api/ lib/ --include="*.ts" --include="*.tsx" -l | sort

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "2. Files with 'pnl' calculations"
echo "═══════════════════════════════════════════════════════════"
grep -r "pnl_usd\|realized_pnl\|unrealized_pnl" app/api/ lib/ --include="*.ts" --include="*.tsx" -l | sort | uniq

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "3. Files calling PnL engine functions"
echo "═══════════════════════════════════════════════════════════"
grep -r "getWalletPnL\|pnlEngine" app/api/ lib/ --include="*.ts" --include="*.tsx" -l | sort | uniq

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "4. Leaderboard endpoints (high priority)"
echo "═══════════════════════════════════════════════════════════"
find app/api -name "*leaderboard*" -type f

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "5. Wallet endpoints (high priority)"
echo "═══════════════════════════════════════════════════════════"
find app/api -path "*/wallet/*" -name "route.ts" -type f

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "6. Cron jobs (need to refresh closed positions)"
echo "═══════════════════════════════════════════════════════════"
find app/api/cron -name "route.ts" -type f | xargs grep -l "fifo\|pnl" | sort

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "SUMMARY: Total files to review"
echo "═══════════════════════════════════════════════════════════"
{
  grep -r "pm_trade_fifo_roi_v3" app/api/ lib/ --include="*.ts" --include="*.tsx" -l
  grep -r "getWalletPnL" app/api/ lib/ --include="*.ts" --include="*.tsx" -l
} | sort | uniq | wc -l
