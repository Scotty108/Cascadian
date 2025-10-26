/**
 * DEPLOYMENT HISTORY SECTION
 *
 * Shows timeline of all strategy deployments and redeployments
 * - Initial deployment
 * - Redeployments with changes
 * - Configuration updates
 * - Status changes (pause/resume)
 */

"use client"

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Rocket, RefreshCw, Settings, Pause, Play, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Deployment {
  deployment_id: string;
  deployment_type: 'initial' | 'redeploy' | 'config_change' | 'pause' | 'resume';
  deployment_status: 'pending' | 'active' | 'paused' | 'failed';
  trading_mode: 'paper' | 'live';
  paper_bankroll_usd?: number;
  execution_mode: 'MANUAL' | 'SCHEDULED';
  schedule_cron?: string;
  changes_summary?: string;
  deployed_at: string;
  activated_at?: string;
  paused_at?: string;
}

interface DeploymentHistorySectionProps {
  strategyId: string;
}

export function DeploymentHistorySection({ strategyId }: DeploymentHistorySectionProps) {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDeployments() {
      try {
        const response = await fetch(`/api/strategies/${strategyId}/deploy`);
        if (response.ok) {
          const data = await response.json();
          setDeployments(data.deployments || []);
        }
      } catch (error) {
        console.error('Failed to fetch deployment history:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchDeployments();
  }, [strategyId]);

  const getDeploymentIcon = (type: Deployment['deployment_type']) => {
    switch (type) {
      case 'initial':
        return <Rocket className="h-4 w-4" />;
      case 'redeploy':
        return <RefreshCw className="h-4 w-4" />;
      case 'config_change':
        return <Settings className="h-4 w-4" />;
      case 'pause':
        return <Pause className="h-4 w-4" />;
      case 'resume':
        return <Play className="h-4 w-4" />;
    }
  };

  const getDeploymentLabel = (type: Deployment['deployment_type']) => {
    switch (type) {
      case 'initial':
        return 'Initial Deployment';
      case 'redeploy':
        return 'Redeployed';
      case 'config_change':
        return 'Configuration Updated';
      case 'pause':
        return 'Paused';
      case 'resume':
        return 'Resumed';
    }
  };

  const getStatusBadge = (status: Deployment['deployment_status']) => {
    const variants: Record<Deployment['deployment_status'], { bg: string; text: string; label: string }> = {
      active: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400', label: 'Active' },
      paused: { bg: 'bg-orange-500/10', text: 'text-orange-600 dark:text-orange-400', label: 'Paused' },
      pending: { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', label: 'Pending' },
      failed: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', label: 'Failed' },
    };

    const variant = variants[status];
    return (
      <Badge variant="outline" className={`${variant.bg} ${variant.text} border-current`}>
        {variant.label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deployment History</CardTitle>
          <CardDescription>Loading deployment timeline...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (deployments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Deployment History</CardTitle>
          <CardDescription>No deployments yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Deploy your strategy to start tracking deployment history.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deployment History</CardTitle>
        <CardDescription>Timeline of all strategy deployments and changes</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {deployments.map((deployment, index) => (
            <div
              key={deployment.deployment_id}
              className="flex items-start gap-4 rounded-lg border p-4 transition hover:bg-muted/50"
            >
              {/* Icon */}
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00E0AA]/10 text-[#00E0AA]">
                {getDeploymentIcon(deployment.deployment_type)}
              </div>

              {/* Content */}
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold">
                      {getDeploymentLabel(deployment.deployment_type)}
                    </h4>
                    {index === 0 && getStatusBadge(deployment.deployment_status)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(deployment.deployed_at), { addSuffix: true })}
                  </div>
                </div>

                {deployment.changes_summary && (
                  <p className="text-sm text-muted-foreground">{deployment.changes_summary}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">
                    {deployment.trading_mode === 'paper' ? '📝 Paper Trading' : '💰 Live Trading'}
                  </Badge>
                  {deployment.trading_mode === 'paper' && deployment.paper_bankroll_usd && (
                    <Badge variant="outline" className="text-xs">
                      ${deployment.paper_bankroll_usd.toLocaleString()} Bankroll
                    </Badge>
                  )}
                  {deployment.schedule_cron && (
                    <Badge variant="outline" className="text-xs">
                      ⏰ {getCronLabel(deployment.schedule_cron)}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Helper to convert cron expression to human-readable label
function getCronLabel(cron: string): string {
  const labels: Record<string, string> = {
    '* * * * *': 'Every 1 min',
    '*/5 * * * *': 'Every 5 min',
    '*/15 * * * *': 'Every 15 min',
    '*/30 * * * *': 'Every 30 min',
    '0 * * * *': 'Every 1 hour',
  };
  return labels[cron] || 'Scheduled';
}
