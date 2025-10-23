# Quick Fix for Vercel Deployment

## The Issue
Vercel is configured with wrong root directory: `~/Projects/Cascadian-app/packages/app`

## The Fix (30 seconds)

### Option 1: Browser (Easiest)
1. **Open**: https://vercel.com/scribeforce/cascadian-app/settings
2. **Find**: "Root Directory" field under "General" settings
3. **Change**: From `~/Projects/Cascadian-app/packages/app` to `.` (single dot)
4. **Save**: Click "Save" button
5. **Deploy**: Vercel will auto-redeploy from GitHub (or manually trigger in "Deployments" tab)

### Option 2: One Command (If you have Vercel access token)
```bash
# Set your Vercel token (get from https://vercel.com/account/tokens)
export VERCEL_TOKEN="your_token_here"

# Run the fix
curl -X PATCH "https://api.vercel.com/v9/projects/prj_zmjoQ1YkXmbq7bQTVAooLnRM7jaC?teamId=team_A7cbE8j9eCVcpDT72gftkOHN" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"rootDirectory":"."}'

# Then deploy
vercel --prod --yes
```

## What Happens After Fix

✅ Vercel will successfully deploy from GitHub
✅ Cron jobs will be enabled automatically:
- Wallet refresh: Every 15 minutes
- Market data sync: Every 30 minutes

✅ All features will be live:
- Whale detection system (7 whales)
- Real-time data APIs
- Workflow builder
- 27k+ trades, 4k+ positions

## Verify Deployment

After fixing, check deployment status:
```bash
vercel ls --prod
```

Should show new deployment with "Ready" status.

## Why This Happened

The Vercel project was previously configured for a monorepo structure with `/packages/app`, but your project is now at the root level. This is a one-time fix.

---

**Everything is committed and ready** ✅
Just need this 30-second configuration change!
