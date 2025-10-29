# Data Directory

This directory contains data files used throughout the application.

## Directory Structure

### `/seed/`
**Seed data and dimension tables** - Essential data for application initialization

Files:
- `markets_dim_seed.json` (1.6MB) - Market dimension seed data
- `events_dim_seed.json` - Event dimension seed data
- `condition_resolution_map.json` (493KB) - Condition to resolution mapping
- `expanded_resolution_map.json` (761KB) - Expanded resolution mapping
- `blocked_wallets_conditions.json` - Blocked wallet conditions
- `events_dim.sql` - Event dimension SQL seed
- `markets_dim.sql` - Market dimension SQL seed
- `wallet-scores-upserts-staged.sql` - Wallet scores staging data

### `/archive/`
**Historical data exports and analysis results** - Archived for reference

Contains:
- Audited PNL reports and wallet analysis
- Validation comparison tables
- Wallet category breakdowns
- Historical leaderboard data
- Realized PNL progress snapshots

## Usage

### Seed Data
Seed data files are used during:
- Initial application setup
- Database migrations
- Development environment setup
- Testing and validation

### Archive Data
Archive data is retained for:
- Historical reference
- Audit trails
- Debugging past issues
- Validating current implementations

## Maintenance

- **Seed data**: Keep up to date with production data periodically
- **Archive data**: Review quarterly and remove files older than 1 year
- **File size**: Monitor large files (>10MB) and compress if needed
