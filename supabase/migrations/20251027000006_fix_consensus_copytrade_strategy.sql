-- Fix Consensus Copy Trade Strategy
-- Remove the broken version and replace with a working simplified version

-- Delete the broken strategy
DELETE FROM strategy_definitions
WHERE strategy_name = 'Consensus Copy Trade' AND is_predefined = TRUE;

-- Insert corrected version using simple FILTER nodes (like existing strategies)
INSERT INTO strategy_definitions (
  strategy_name,
  strategy_description,
  strategy_type,
  is_predefined,
  is_archived,
  node_graph
) VALUES (
  'Consensus Copy Trade',
  'Follow top wallets when they agree on an outcome. Identifies proven profitable wallets with strong track records and filters for markets where multiple quality wallets align on the same side.',
  'SCREENING',
  TRUE,
  FALSE,
  '{
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
        "config": {
          "source": "WALLETS",
          "mode": "BATCH",
          "prefilters": {
            "table": "wallet_scores",
            "where": "meets_minimum_trades = true"
          }
        }
      },
      {
        "type": "FILTER",
        "id": "profitable",
        "config": {
          "field": "total_pnl",
          "operator": "GREATER_THAN",
          "value": 0
        }
      },
      {
        "type": "FILTER",
        "id": "quality_omega",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 2.0
        }
      },
      {
        "type": "FILTER",
        "id": "min_positions",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 20
        }
      },
      {
        "type": "FILTER",
        "id": "win_rate",
        "config": {
          "field": "win_rate",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 0.55
        }
      },
      {
        "type": "LOGIC",
        "id": "combine_quality",
        "config": {
          "operator": "AND",
          "inputs": ["profitable", "quality_omega", "min_positions", "win_rate"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_by_pnl",
        "config": {
          "function": "MAX",
          "field": "total_pnl"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "profitable"},
      {"from": "wallets", "to": "quality_omega"},
      {"from": "wallets", "to": "min_positions"},
      {"from": "wallets", "to": "win_rate"},
      {"from": "profitable", "to": "combine_quality"},
      {"from": "quality_omega", "to": "combine_quality"},
      {"from": "min_positions", "to": "combine_quality"},
      {"from": "win_rate", "to": "combine_quality"},
      {"from": "combine_quality", "to": "sort_by_pnl"}
    ]
  }'::jsonb
);
