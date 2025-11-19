# CASCADIAN Backup/Recovery Quick Reference

## RPC Endpoints Found

### Primary
- **Alchemy Polygon**: `https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO`
- **Alchemy Ethereum**: `https://eth-mainnet.g.alchemy.com/v2/agpW5gfZvLIqqNUZy9fTu`

### Fallback
- **Public Polygon RPC**: `https://polygon-rpc.com`

## Checkpoint System

### Location
- Main: `/Users/scotty/Projects/Cascadian-app/runtime/`
- Archive: `/Users/scotty/Projects/Cascadian-app/runtime/old-checkpoints/`
- CLOB: `/Users/scotty/Projects/Cascadian-app/.clob_checkpoints/`

### File Types
- Blockchain fetch: `blockchain-fetch-checkpoint-worker-*.json` (12 workers)
- Goldsky: `goldsky-*.checkpoint.json`
- Payout: `payout-backfill-worker*.checkpoint.json`
- CLOB: `{wallet_address}.json`

### Key Data Points
Each checkpoint contains:
- `lastProcessedBlock` - Resume point for backfill
- `totalEvents` / `totalTrades` - Progress metrics
- `uniqueWallets` - Wallets discovered in batch
- `errors` - Detailed error logs with block references
- `startTime` - ISO8601 timestamp

## Backup/Recovery Patterns

### Atomic Table Swap (Safe Pattern)
```
1. CREATE TABLE staging AS SELECT ... (new data)
2. RENAME TABLE production TO production_backup_TIMESTAMP
3. RENAME TABLE staging TO production
```

### Rollback Command
```bash
npx tsx scripts/rollback-swap.ts
```

## Critical Recovery Scripts

| Script | Purpose | Runtime |
|--------|---------|---------|
| `rollback-swap.ts` | Immediate table rollback | <1 min |
| `gate-b-full-recovery.ts` | Full condition ID recovery | 30-90 min |
| `blockchain-resolution-backfill.ts` | Resolution data recovery | 2-4 hours |
| `dedup-forensics-and-rebuild.ts` | Forensics + atomic rebuild | Variable |

## Recovery Procedures

### Full Recovery Workflow
```bash
# Step 1: Setup (30s)
npx tsx scripts/gate-b-step1-setup-views.ts

# Step 2: Blockchain backfill (30-90 min)
npx tsx scripts/gate-b-step2-blockchain-backfill.ts

# Step 3: Patch tables (2-5 min)
npx tsx scripts/gate-b-step3-patch-fact-table.ts

# Step 4: Verify (30s)
npx tsx scripts/gate-b-step4-verify-gates.ts
```

## Database Configuration

**ClickHouse Cloud**
- Host: `https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443`
- Database: `default`
- Timeouts: 300s for inserts, 60-120s for queries

## Key Files Reference

- Full documentation: `EXPLORATION_FINDINGS_BACKUP_RECOVERY_RPC.md`
- Recovery guide: `docs/operations/GATE_B_RECOVERY_GUIDE.md`
- Rollback script: `scripts/rollback-swap.ts`
- Blockchain backfill: `scripts/blockchain-resolution-backfill.ts`

## Error Handling

RPC errors are tracked in checkpoints:
- 502 Bad Gateway (Cloudflare)
- 429 Rate limit exhaustion (with 10m retry window)
- Missing responses from getLogs

Rate limiting: 40ms between requests (25 req/sec per worker)

## Timestamp Recovery

1.6M timestamps can be recovered from:
1. Checkpoint files: `lastProcessedBlock` and error blocks
2. Block timestamps via RPC: `provider.getBlock(blockNumber)`
3. ClickHouse query log: `system.query_log`
