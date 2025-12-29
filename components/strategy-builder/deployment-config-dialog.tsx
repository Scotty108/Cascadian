/**
 * DEPLOYMENT CONFIGURATION DIALOG
 *
 * Modal dialog shown when user clicks "Deploy Strategy"
 * Configures:
 * - Trading mode (paper vs live)
 * - Paper bankroll amount
 * - Execution schedule (frequency)
 * - Auto-start option
 */

"use client"

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Rocket,
  DollarSign,
  Shield,
  Clock,
  AlertTriangle,
  Info,
  Zap,
} from 'lucide-react';

export interface DeploymentConfig {
  trading_mode: 'paper' | 'live';
  paper_bankroll_usd: number;
  execution_frequency: '1min' | '5min' | '15min' | '30min' | '1hour';
  auto_start: boolean;
}

interface DeploymentConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strategyName: string;
  onDeploy: (config: DeploymentConfig) => void;
  isDeploying?: boolean;
}

const FREQUENCY_OPTIONS = [
  { value: '1min', label: 'Every 1 minute', cron: '* * * * *' },
  { value: '5min', label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { value: '15min', label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { value: '30min', label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { value: '1hour', label: 'Every 1 hour', cron: '0 * * * *' },
];

export default function DeploymentConfigDialog({
  open,
  onOpenChange,
  strategyName,
  onDeploy,
  isDeploying = false,
}: DeploymentConfigDialogProps) {
  const [config, setConfig] = useState<DeploymentConfig>({
    trading_mode: 'paper',
    paper_bankroll_usd: 10000,
    execution_frequency: '5min',
    auto_start: true,
  });

  // Reset to defaults when dialog opens
  useEffect(() => {
    if (open) {
      setConfig({
        trading_mode: 'paper',
        paper_bankroll_usd: 10000,
        execution_frequency: '5min',
        auto_start: true,
      });
    }
  }, [open]);

  const handleDeploy = () => {
    onDeploy(config);
  };

  const isLiveMode = config.trading_mode === 'live';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00E0AA]/10">
              <Rocket className="h-5 w-5 text-[#00E0AA]" />
            </div>
            <div>
              <DialogTitle>Deploy Strategy</DialogTitle>
              <DialogDescription>
                Configure autonomous execution for &quot;{strategyName}&quot;
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Trading Mode */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-1">Trading Mode</h3>
              <p className="text-xs text-muted-foreground">
                Choose whether to use real money or virtual money
              </p>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                {isLiveMode ? (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
                    <DollarSign className="h-5 w-5 text-red-600 dark:text-red-400" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10">
                    <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                )}
                <div>
                  <Label htmlFor="trading-mode" className="text-base font-semibold">
                    {isLiveMode ? 'Live Trading (Real Money)' : 'Paper Trading (Virtual Money)'}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {isLiveMode
                      ? 'Strategy will place real trades on Polymarket'
                      : 'Strategy will use virtual money for testing'}
                  </p>
                </div>
              </div>
              <Switch
                id="trading-mode"
                checked={isLiveMode}
                onCheckedChange={(checked) =>
                  setConfig({ ...config, trading_mode: checked ? 'live' : 'paper' })
                }
              />
            </div>

            {/* Warning for live mode */}
            {isLiveMode && (
              <Alert className="border-red-500/50 bg-red-500/10">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <AlertDescription className="text-sm text-red-900 dark:text-red-100">
                  <strong>Warning:</strong> Live trading will use real USDC from your connected wallet.
                  All trades are irreversible. Only proceed if you understand the risks.
                </AlertDescription>
              </Alert>
            )}

            {/* Paper bankroll (only for paper mode) */}
            {!isLiveMode && (
              <div className="space-y-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="paper-bankroll" className="text-sm font-medium">
                    Virtual Bankroll
                  </Label>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    id="paper-bankroll"
                    type="number"
                    min={100}
                    max={1000000}
                    step={100}
                    value={config.paper_bankroll_usd}
                    onChange={(e) =>
                      setConfig({ ...config, paper_bankroll_usd: Number(e.target.value) })
                    }
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Minimum: $100 • Maximum: $1,000,000
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Execution Schedule */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4" />
                <h3 className="text-sm font-semibold">Execution Schedule</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                How often should the strategy scan for opportunities?
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="frequency">Execution Frequency</Label>
              <Select
                value={config.execution_frequency}
                onValueChange={(value: any) =>
                  setConfig({ ...config, execution_frequency: value })
                }
              >
                <SelectTrigger id="frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The strategy will automatically scan markets and make decisions on this schedule
              </p>
            </div>

            <Alert className="bg-background/50">
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                More frequent execution allows faster responses to market opportunities but may increase
                costs (for live trading) and API usage.
              </AlertDescription>
            </Alert>
          </div>

          <Separator />

          {/* Auto-start */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/10">
                <Zap className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <Label htmlFor="auto-start" className="text-base font-semibold">
                  Start Immediately
                </Label>
                <p className="text-sm text-muted-foreground">
                  Begin executing the strategy right after deployment
                </p>
              </div>
            </div>
            <Switch
              id="auto-start"
              checked={config.auto_start}
              onCheckedChange={(checked) => setConfig({ ...config, auto_start: checked })}
            />
          </div>

          {/* Summary */}
          <div className="rounded-lg border bg-muted/50 p-4">
            <h4 className="text-sm font-semibold mb-3">Deployment Summary</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Strategy:</span>
                <span className="font-medium">{strategyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trading Mode:</span>
                <span className="font-medium">
                  {isLiveMode ? '🔴 Live Trading' : '🟢 Paper Trading'}
                </span>
              </div>
              {!isLiveMode && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Virtual Bankroll:</span>
                  <span className="font-medium">${config.paper_bankroll_usd.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Frequency:</span>
                <span className="font-medium">
                  {FREQUENCY_OPTIONS.find((o) => o.value === config.execution_frequency)?.label}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auto-start:</span>
                <span className="font-medium">{config.auto_start ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeploying}>
            Cancel
          </Button>
          <Button onClick={handleDeploy} disabled={isDeploying} className="bg-[#00E0AA] text-slate-950 hover:bg-[#00E0AA]/90">
            {isDeploying ? (
              <>
                <Rocket className="h-4 w-4 mr-2 animate-pulse" />
                Deploying...
              </>
            ) : (
              <>
                <Rocket className="h-4 w-4 mr-2" />
                Deploy Strategy
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
