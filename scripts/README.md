# Scripts Directory

This directory contains operational scripts for development, deployment, and maintenance.

## Directory Structure

### Root Scripts
Commonly used scripts in the root:
- `full-enrichment-pass.ts` - Run complete data enrichment
- `goldsky-full-historical-load.ts` - Load historical data from Goldsky
- `overnight-orchestrator.ts` - Overnight batch processing
- `system-healthcheck.ts` - System health monitoring

### `/migration/`
Database migration scripts
- Scripts for applying database migrations
- Copy trading migration utilities
- Critical migration scripts

### `/goldsky/`
Goldsky API integration scripts
- Historical data loading
- Batch processing
- API testing and validation

### `/wallet-analysis/`
Wallet analytics and discovery scripts
- Wallet discovery from various sources
- Wallet metrics computation
- Active wallet analysis
- Category-based analysis

### `/testing/`
Test scripts and validation utilities
- API testing
- Data validation
- Integration testing
- Performance testing

### `/archive/`
Archived/deprecated scripts
- Old migration script variants
- Deprecated utilities
- Historical test scripts

## Common Operations

### Running Enrichment
```bash
npx tsx scripts/full-enrichment-pass.ts
```

### System Health Check
```bash
npx tsx scripts/system-healthcheck.ts
```

### Database Migrations
```bash
npx tsx scripts/migration/apply-migration.ts
```

### Goldsky Data Load
```bash
npx tsx scripts/goldsky/goldsky-full-historical-load.ts
```

## Best Practices

1. **One canonical version** - Archive duplicate scripts, keep only the active version
2. **Clear naming** - Use descriptive names indicating what the script does
3. **Documentation** - Add comments at the top explaining purpose and usage
4. **Error handling** - Scripts should handle errors gracefully
5. **Environment variables** - Use `.env.local` for configuration
6. **Logging** - Include proper logging for debugging

## Script Categories

### Migration Scripts
Use for database schema and data migrations. Keep one canonical version of each type.

### Analysis Scripts
Use for ad-hoc data analysis and investigation. Archive when analysis is complete.

### Operational Scripts
Use for regular operations like enrichment, syncing, and monitoring. Keep updated.

### Test Scripts
Use for testing integrations and validating implementations. Keep active tests, archive completed ones.

## Maintenance

- **Archive duplicates** - Move old script versions to `/archive/`
- **Document decisions** - Note why scripts were archived
- **Clean up regularly** - Review quarterly and remove obsolete scripts
- **Update dependencies** - Keep TypeScript and dependencies current
