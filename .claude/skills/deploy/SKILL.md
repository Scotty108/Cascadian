---
name: deploy
description: Deploy Cascadian to Vercel production with pre-flight checks. Use when deploying, pushing to prod, or shipping changes. Includes build validation, git status check, and deployment verification.
disable-model-invocation: true
argument-hint: [--prod or --preview]
---

# Deploy to Vercel

Safe deployment workflow with pre-flight checks. Only invoked manually via `/deploy`.

## Pre-Flight Checklist

Before deploying, verify ALL of the following:

### 1. Git Status
```bash
git status
git log --oneline -5
```
- Confirm working tree is clean (no uncommitted changes)
- Confirm you're on the right branch
- Review recent commits that will be deployed

### 2. Build Check
```bash
npx next build 2>&1 | tail -30
```
- Must complete without errors
- Check for TypeScript errors
- Check for missing imports

### 3. Verify Vercel Project Link
```bash
# Must be linked to 'cascadian' project (NOT 'cascadian-app')
cat .vercel/project.json 2>/dev/null || echo "Not linked"
```

**IMPORTANT**: Local directory is `Cascadian-app` but deploys to `cascadian` Vercel project.

If not linked:
```bash
npx vercel link --yes --project cascadian
```

### 4. Environment Check
- Verify `.env.local` has required variables
- Check that Vercel project has matching env vars

## Deployment

### Production Deploy
```bash
npx vercel --prod
```

### Preview Deploy (default)
```bash
npx vercel
```

## Post-Deploy Verification

After deployment completes:

1. **Check deployment URL** - Visit the URL returned by Vercel
2. **Check cron health** - Use `/cron-status` to verify crons are running
3. **Check API endpoints** - Verify key endpoints respond:
   - `/api/leaderboard/ultra-active`
   - `/api/copy-trading/leaderboard`

## Output Format

```
DEPLOYMENT CHECKLIST

Pre-Flight
  [x] Git clean, branch: [branch]
  [x] Build passes (no errors)
  [x] Vercel linked to 'cascadian' project
  [x] Recent commits: [list]

Deploying...
  Target: [production/preview]
  URL: [deployment URL]

Post-Deploy
  [ ] Site loads
  [ ] Crons healthy (/cron-status)
  [ ] Key APIs responding
```

## Rollback

If something goes wrong:
```bash
# List recent deployments
npx vercel ls

# Rollback to previous
npx vercel rollback
```

## Two Vercel Projects (Don't Confuse!)

| Project | Repo | Domain | Status |
|---------|------|--------|--------|
| cascadian | Scotty108/Cascadian | cascadian.vercel.app | Production |
| cascadian-app | Scotty108/Cascadian-app | (preview only) | Builds failing |

Always deploy to `cascadian` project!
