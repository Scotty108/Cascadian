-- Strategy Builder Tables
-- Enables visual, node-based strategy creation and execution

-- ============================================================================
-- Strategy Definitions Table
-- Stores user-created and predefined strategies as node graphs
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_definitions (
  -- Identity
  strategy_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name TEXT NOT NULL,
  strategy_description TEXT,

  -- Type
  strategy_type TEXT NOT NULL CHECK (strategy_type IN ('SCREENING', 'MOMENTUM', 'ARBITRAGE', 'CUSTOM')),
  is_predefined BOOLEAN DEFAULT FALSE,

  -- Node Graph (JSON)
  node_graph JSONB NOT NULL,
  /*
  Example structure:
  {
    "nodes": [
      { "type": "DATA_SOURCE", "id": "wallets", "config": {...} },
      { "type": "FILTER", "id": "omega_filter", "config": {...} },
      { "type": "LOGIC", "id": "and_logic", "config": {...} },
      { "type": "SIGNAL", "id": "entry_signal", "config": {...} }
    ],
    "edges": [
      { "from": "wallets", "to": "omega_filter" },
      { "from": "omega_filter", "to": "and_logic" }
    ]
  }
  */

  -- Execution Settings
  execution_mode TEXT DEFAULT 'MANUAL' CHECK (execution_mode IN ('MANUAL', 'AUTO', 'SCHEDULED')),
  schedule_cron TEXT,
  is_active BOOLEAN DEFAULT TRUE,

  -- Performance Tracking
  total_executions INTEGER DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  avg_execution_time_ms INTEGER,

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Version Control
  version INTEGER DEFAULT 1,
  parent_strategy_id UUID REFERENCES strategy_definitions(strategy_id)
);

-- Indexes
CREATE INDEX idx_strategy_type ON strategy_definitions(strategy_type);
CREATE INDEX idx_active_strategies ON strategy_definitions(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_predefined_strategies ON strategy_definitions(is_predefined) WHERE is_predefined = TRUE;
CREATE INDEX idx_created_by ON strategy_definitions(created_by);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_strategy_definitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_strategy_definitions_updated_at_trigger
  BEFORE UPDATE ON strategy_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_strategy_definitions_updated_at();

-- Comments
COMMENT ON TABLE strategy_definitions IS 'User-defined and predefined trading strategies using node-based composition';
COMMENT ON COLUMN strategy_definitions.node_graph IS 'JSON graph structure with nodes (DATA_SOURCE, FILTER, LOGIC, AGGREGATION, SIGNAL, ACTION) and edges';
COMMENT ON COLUMN strategy_definitions.is_predefined IS 'True for the 11 predefined strategies from DATABASE_ARCHITECT_SPEC.md';
COMMENT ON COLUMN strategy_definitions.execution_mode IS 'MANUAL = user-triggered, AUTO = runs on data updates, SCHEDULED = cron-based';

-- ============================================================================
-- Strategy Executions Table
-- Tracks execution history and results for strategies
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_executions (
  -- Identity
  execution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,

  -- Execution Context
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('MANUAL', 'AUTO', 'SCHEDULED')),
  triggered_by UUID REFERENCES auth.users(id),

  -- Results (JSON)
  results JSONB NOT NULL,
  /*
  Example structure:
  {
    "matched_wallets": ["0x123...", "0x456..."],
    "matched_markets": ["market_123", "market_456"],
    "signals_generated": [
      { "signal_id": "sig_1", "type": "ENTRY", "market_id": "market_123", ... }
    ],
    "aggregations": {
      "total_wallets": 15,
      "avg_omega": 3.2,
      "total_pnl": 12500.50
    }
  }
  */

  -- Performance
  execution_time_ms INTEGER NOT NULL,
  nodes_evaluated INTEGER NOT NULL,
  data_points_processed INTEGER NOT NULL,

  -- Status
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED')),
  error_message TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_strategy_executions_strategy ON strategy_executions(strategy_id, executed_at DESC);
CREATE INDEX idx_strategy_executions_status ON strategy_executions(status);
CREATE INDEX idx_strategy_executions_triggered_by ON strategy_executions(triggered_by);

-- Comments
COMMENT ON TABLE strategy_executions IS 'Execution history and results for strategies';
COMMENT ON COLUMN strategy_executions.results IS 'JSON with matched items, signals generated, and aggregation results';
COMMENT ON COLUMN strategy_executions.nodes_evaluated IS 'How many nodes in the graph were executed';
COMMENT ON COLUMN strategy_executions.data_points_processed IS 'Total records processed across all nodes';

-- ============================================================================
-- Seed Predefined Strategies
-- 3 strategies that work with EXISTING metrics (no ClickHouse dependencies)
-- ============================================================================

INSERT INTO strategy_definitions (strategy_name, strategy_description, strategy_type, is_predefined, node_graph) VALUES

-- Strategy 2: "Balanced Hybrid"
(
  'Balanced Hybrid',
  'Find profitable traders with strong competency and risk management. Uses the "Stupid Filter" (omega >= 2.0) and sorts by pure dollar profit.',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_scores",
            "where": "meets_minimum_trades = true"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "min_trades",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 50
        }
      },
      {
        "type": "FILTER",
        "id": "omega_filter",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 2.0
        }
      },
      {
        "type": "FILTER",
        "id": "grade_filter",
        "config": {
          "field": "grade",
          "operator": "IN",
          "value": ["S", "A", "B"]
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["min_trades", "omega_filter", "grade_filter"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_pnl",
        "config": {
          "function": "MAX",
          "field": "total_pnl"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "min_trades"},
      {"from": "wallets", "to": "omega_filter"},
      {"from": "wallets", "to": "grade_filter"},
      {"from": "min_trades", "to": "combine"},
      {"from": "omega_filter", "to": "combine"},
      {"from": "grade_filter", "to": "combine"},
      {"from": "combine", "to": "sort_pnl"}
    ]
  }'::jsonb
),

-- Strategy 3: "Eggman Hunter"
(
  'Eggman Hunter (AI Specialist)',
  'Find the next "Eggman" in AI category. Identifies true forecasting skill with category-specific omega >= 3.0 (S-grade).',
  'SCREENING',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "category_scores",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_scores_by_category",
            "where": "meets_minimum_trades = true"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "ai_only",
        "config": {
          "field": "category",
          "operator": "EQUALS",
          "value": "AI"
        }
      },
      {
        "type": "FILTER",
        "id": "min_bets",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 10,
          "categorySpecific": {
            "enabled": true,
            "category": "AI"
          }
        }
      },
      {
        "type": "FILTER",
        "id": "s_grade",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 3.0,
          "categorySpecific": {
            "enabled": true,
            "category": "AI"
          }
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["ai_only", "min_bets", "s_grade"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_roi",
        "config": {
          "function": "MAX",
          "field": "roi_per_bet"
        }
      }
    ],
    "edges": [
      {"from": "category_scores", "to": "ai_only"},
      {"from": "category_scores", "to": "min_bets"},
      {"from": "category_scores", "to": "s_grade"},
      {"from": "ai_only", "to": "combine"},
      {"from": "min_bets", "to": "combine"},
      {"from": "s_grade", "to": "combine"},
      {"from": "combine", "to": "sort_roi"}
    ]
  }'::jsonb
),

-- Strategy 5: "Momentum Rider"
(
  'Momentum Rider',
  'Find traders currently on a hot streak. Identifies wallets with positive omega momentum and verifiably improving performance.',
  'MOMENTUM',
  TRUE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "prefilters": {
            "table": "wallet_scores",
            "where": "meets_minimum_trades = true"
          },
          "mode": "BATCH"
        }
      },
      {
        "type": "FILTER",
        "id": "min_history",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 100
        }
      },
      {
        "type": "FILTER",
        "id": "omega_up",
        "config": {
          "field": "omega_momentum",
          "operator": "GREATER_THAN",
          "value": 0
        }
      },
      {
        "type": "FILTER",
        "id": "improving",
        "config": {
          "field": "momentum_direction",
          "operator": "EQUALS",
          "value": "improving"
        }
      },
      {
        "type": "LOGIC",
        "id": "combine",
        "config": {
          "operator": "AND",
          "inputs": ["min_history", "omega_up", "improving"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_momentum",
        "config": {
          "function": "MAX",
          "field": "omega_momentum"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "min_history"},
      {"from": "wallets", "to": "omega_up"},
      {"from": "wallets", "to": "improving"},
      {"from": "min_history", "to": "combine"},
      {"from": "omega_up", "to": "combine"},
      {"from": "improving", "to": "combine"},
      {"from": "combine", "to": "sort_momentum"}
    ]
  }'::jsonb
);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE strategy_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_executions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read all predefined strategies
CREATE POLICY "predefined_strategies_readable_by_all"
  ON strategy_definitions
  FOR SELECT
  USING (is_predefined = TRUE);

-- Policy: Users can read their own custom strategies
CREATE POLICY "custom_strategies_readable_by_owner"
  ON strategy_definitions
  FOR SELECT
  USING (created_by = auth.uid());

-- Policy: Users can create their own strategies
CREATE POLICY "users_can_create_strategies"
  ON strategy_definitions
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Policy: Users can update their own strategies
CREATE POLICY "users_can_update_own_strategies"
  ON strategy_definitions
  FOR UPDATE
  USING (created_by = auth.uid());

-- Policy: Users can delete their own strategies
CREATE POLICY "users_can_delete_own_strategies"
  ON strategy_definitions
  FOR DELETE
  USING (created_by = auth.uid());

-- Policy: Users can read their own execution history
CREATE POLICY "executions_readable_by_owner"
  ON strategy_executions
  FOR SELECT
  USING (triggered_by = auth.uid());

-- Policy: Users can create executions
CREATE POLICY "users_can_create_executions"
  ON strategy_executions
  FOR INSERT
  WITH CHECK (triggered_by = auth.uid());
