/**
 * Create wallet filtering tables manually
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function createTables() {
  console.log('🚀 Creating Wallet Filtering Tables\n')

  try {
    // Check if tables already exist
    console.log('📋 Checking existing tables...\n')

    const { data: existingTables, error: tablesError } = await supabase
      .from('wallet_scores_by_category')
      .select('id')
      .limit(1)

    if (!tablesError) {
      console.log('✅ wallet_scores_by_category table already exists!')
    } else if (tablesError.message.includes('relation') || tablesError.message.includes('does not exist')) {
      console.log('❌ wallet_scores_by_category table does not exist')
      console.log('\n📋 To create it, run this SQL in Supabase Dashboard SQL Editor:\n')
      console.log('---')
      console.log(`
CREATE TABLE IF NOT EXISTS wallet_scores_by_category (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  category TEXT NOT NULL,
  omega_ratio DECIMAL(10, 4),
  omega_momentum DECIMAL(10, 4),
  total_positions INTEGER DEFAULT 0,
  closed_positions INTEGER DEFAULT 0,
  total_pnl DECIMAL(18, 2),
  total_gains DECIMAL(18, 2),
  total_losses DECIMAL(18, 2),
  win_rate DECIMAL(5, 4),
  avg_gain DECIMAL(18, 2),
  avg_loss DECIMAL(18, 2),
  roi_per_bet DECIMAL(18, 2),
  overall_roi DECIMAL(10, 4),
  momentum_direction TEXT CHECK (momentum_direction IN ('improving', 'declining', 'stable', 'insufficient_data')),
  grade TEXT CHECK (grade IN ('S', 'A', 'B', 'C', 'D', 'F')),
  meets_minimum_trades BOOLEAN DEFAULT FALSE,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_scores_by_category_unique UNIQUE (wallet_address, category)
);

CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_wallet ON wallet_scores_by_category(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_category ON wallet_scores_by_category(category);
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_omega ON wallet_scores_by_category(category, omega_ratio DESC) WHERE meets_minimum_trades = TRUE;
CREATE INDEX IF NOT EXISTS idx_wallet_scores_by_category_roi ON wallet_scores_by_category(category, roi_per_bet DESC) WHERE meets_minimum_trades = TRUE;
      `)
      console.log('---\n')
    }

    const { data: existingCriteria, error: criteriaError } = await supabase
      .from('wallet_tracking_criteria')
      .select('id')
      .limit(1)

    if (!criteriaError) {
      console.log('✅ wallet_tracking_criteria table already exists!')
    } else if (criteriaError.message.includes('relation') || criteriaError.message.includes('does not exist')) {
      console.log('❌ wallet_tracking_criteria table does not exist')
      console.log('\n📋 To create it, run this SQL in Supabase Dashboard SQL Editor:\n')
      console.log('---')
      console.log(`
CREATE TABLE IF NOT EXISTS wallet_tracking_criteria (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  name TEXT NOT NULL,
  description TEXT,
  min_omega_ratio DECIMAL(10, 4),
  max_omega_ratio DECIMAL(10, 4),
  min_omega_momentum DECIMAL(10, 4),
  min_total_pnl DECIMAL(18, 2),
  min_roi_per_bet DECIMAL(18, 2),
  min_overall_roi DECIMAL(10, 4),
  min_win_rate DECIMAL(5, 4),
  min_closed_positions INTEGER,
  min_total_positions INTEGER,
  allowed_grades TEXT[],
  allowed_momentum TEXT[],
  categories TEXT[],
  category_match_mode TEXT CHECK (category_match_mode IN ('any', 'all', 'primary')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tracking_criteria_user ON wallet_tracking_criteria(user_id) WHERE is_active = TRUE;

INSERT INTO wallet_tracking_criteria (name, description, min_omega_ratio, min_closed_positions, allowed_grades, is_active)
VALUES
  ('Elite Performers', 'Top tier wallets with exceptional omega ratios', 3.0, 20, ARRAY['S', 'A'], TRUE),
  ('Consistent Winners', 'Solid performers with good track records', 1.5, 50, ARRAY['A', 'B', 'C'], TRUE),
  ('High Volume Traders', 'Active traders with many positions', 1.0, 100, ARRAY['S', 'A', 'B', 'C'], TRUE),
  ('Improving Momentum', 'Wallets with positive momentum', 1.0, 10, ARRAY['S', 'A', 'B'], TRUE)
ON CONFLICT DO NOTHING;

UPDATE wallet_tracking_criteria SET allowed_momentum = ARRAY['improving'] WHERE name = 'Improving Momentum';
      `)
      console.log('---\n')
    }

    console.log('\n💡 Copy and paste the SQL above into: https://supabase.com/dashboard (SQL Editor)')
    console.log('   Then run: npx tsx scripts/calculate-category-omega.ts')

  } catch (error) {
    console.error('❌ Error:', error)
  }
}

createTables()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
