# Cron-Based Nightly Refresh

This repository now includes a single entry-point (`scripts/nightly-refresh.ts`) that sequences every Polymarket data step:

1. ERC-1155 backfill (`scripts/phase2-erc1155-backfill-fixed.ts`)
2. ERC-1155 flatten (`scripts/flatten-erc1155.ts`)
3. Wallet/token map rebuild (`build-system-wallet-map-v2.ts`)
4. Fact rebuild (`build-fact-trades.ts`)
5. P&L views (`build-pnl-views.ts`)
6. Polymarket parity smoke test (`validate-polymarket-parity.ts`)

Each stage runs with live console output and enforces row-count gates so the next step only runs when prerequisites are satisfied.

## Usage

```bash
# One-off run
npx tsx scripts/nightly-refresh.ts

# Skip a step (comma separated if multiple)
npx tsx scripts/nightly-refresh.ts --skip=backfill,parity
```

Environment variables (optional):

- `REFRESH_SKIP_STEPS` – comma-separated list of step IDs (`backfill`, `flatten`, `wallet-map`, `fact`, `pnl-views`, `parity`).
- `REFRESH_MIN_ERC1155_ROWS` – override ERC-1155 raw row count gate (default 5,000,000).
- `REFRESH_MIN_ERC1155_FLATS_ROWS` – override flattened row gate (default 1,000,000).
- `REFRESH_MIN_FACT_ROWS` – override fact table gate (default 100,000,000).

## Cron Example

1. Ensure the repo has the latest code and `.env.local` is populated.
2. Add a cron entry (example: run daily at 02:30 UTC):

```cron
30 2 * * * cd /path/to/Cascadian-app && /usr/bin/env PATH=$PATH:/usr/local/bin npx tsx scripts/nightly-refresh.ts >> logs/nightly-refresh.log 2>&1
```

3. Monitor `logs/nightly-refresh.log` or set up a log shipper / alerting for failures (non-zero exit).

## Failure Handling

- Each step stops the pipeline on non-zero exit; gates verify ClickHouse row counts before continuing.
- The ERC-1155 backfill remains checkpoint-aware, so cron reruns will resume where they left off.
- The script exits with code `1` when any stage fails; use cronmail, systemd, or another supervisor for notifications.

## Next Ideas

- Wire `scripts/nightly-refresh.ts` into a workflow orchestrator (Airflow, Dagster, Temporal) for retries and parallelism.
- Push refresh status into `monitor-pipeline-status.ts`/Slack once available.
