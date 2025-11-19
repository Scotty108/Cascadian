# Raw Idea: Backend Setup (Supabase + Database Schema)

**Feature Name**: Backend Setup (Supabase + Database Schema)

**Brief Description**: Complete backend infrastructure setup including dual-database architecture (ClickHouse for analytics + Supabase for operational data), data ingestion pipelines, dimension tables, and automated enrichment workflows.

## Key Context from Exploration

### Architecture
- **Dual database approach**:
  - ClickHouse: 15 analytical tables for high-performance analytics
  - Supabase: 40+ operational tables for application data

### Current Status
- Schema designed and many tables created
- Critical gaps identified:
  - 86% of trades missing market_id (needs backfill)
  - Dimension tables need loading
  - Background jobs not scheduled

### Data Sources
- Goldsky GraphQL (free tier)
- Polymarket APIs

### Validation & Metrics
- 548 audited signal wallets
- 99.79% P&L accuracy achieved
- Complete PnL engine implemented
- Category attribution system in place
- Resolution accuracy tracking operational

## Scope

This spec covers the complete backend infrastructure setup required to support the Cascadian application, including:
1. Dual-database architecture (ClickHouse + Supabase)
2. Data ingestion pipelines from Goldsky and Polymarket
3. Dimension table loading and maintenance
4. Automated enrichment workflows
5. Background job scheduling
6. Data quality and accuracy validation
