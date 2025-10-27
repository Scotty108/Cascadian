'use client';

import { useState, useEffect } from 'react';

export interface Strategy {
  strategy_id: string;
  strategy_name: string;
  strategy_description: string;
  strategy_type: string;
  is_predefined: boolean;
  is_archived?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  execution_mode: string;
  node_graph?: any;
  schedule_cron?: string;
  // Add metrics that we'll calculate
  total_executions?: number;
  last_executed_at?: string;
}

export function useStrategies() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStrategies = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/strategies');
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch strategies');
      }

      setStrategies(data.strategies || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load strategies');
      setStrategies([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStrategies();
  }, []);

  return { strategies, loading, error, refresh: fetchStrategies };
}
