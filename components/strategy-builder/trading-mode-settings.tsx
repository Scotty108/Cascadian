/**
 * TRADING MODE SETTINGS COMPONENT
 *
 * Allows users to configure paper trading vs live trading for a strategy
 * - Toggle between paper and live trading modes
 * - Set paper trading bankroll amount
 * - Display warnings when switching modes
 */

"use client"

import React from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Shield,
  Info
} from 'lucide-react';

export interface TradingModeConfig {
  trading_mode: 'paper' | 'live';
  paper_bankroll_usd: number;
}

interface TradingModeSettingsProps {
  config: TradingModeConfig;
  onChange: (config: TradingModeConfig) => void;
  hasOpenPositions?: boolean; // Prevent switching if there are open positions
}

export default function TradingModeSettings({
  config,
  onChange,
  hasOpenPositions = false
}: TradingModeSettingsProps) {
  const isLiveMode = config.trading_mode === 'live';

  const handleModeToggle = (checked: boolean) => {
    // checked = true means Live mode
    // checked = false means Paper mode
    onChange({
      ...config,
      trading_mode: checked ? 'live' : 'paper',
    });
  };

  const handleBankrollChange = (value: number) => {
    onChange({
      ...config,
      paper_bankroll_usd: Math.max(100, value), // Minimum $100
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">Trading Mode</h3>
        <p className="text-sm text-muted-foreground">
          Configure whether this strategy uses real money or virtual money
        </p>
      </div>

      <Separator />

      {/* Mode Toggle */}
      <div className="space-y-4">
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
            onCheckedChange={handleModeToggle}
            disabled={hasOpenPositions}
          />
        </div>

        {/* Warning when switching to live */}
        {isLiveMode && (
          <Alert className="border-red-500/50 bg-red-500/10">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            <AlertDescription className="text-sm text-red-900 dark:text-red-100">
              <strong>Warning:</strong> Live trading mode will place real trades with real money on Polymarket.
              Please ensure you understand the risks and have configured your position sizing rules carefully.
            </AlertDescription>
          </Alert>
        )}

        {/* Open positions warning */}
        {hasOpenPositions && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <AlertDescription className="text-sm text-yellow-900 dark:text-yellow-100">
              Cannot change trading mode while strategy has open positions.
              Please close all positions first.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Paper Trading Settings */}
      {!isLiveMode && (
        <>
          <Separator />

          <div className="space-y-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <h4 className="font-semibold">Paper Trading Configuration</h4>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="paper-bankroll" className="text-sm font-medium">
                    Virtual Bankroll
                  </Label>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label="Amount of virtual money allocated to this strategy" />
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
                    onChange={(e) => handleBankrollChange(Number(e.target.value))}
                    className="pl-7"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Minimum: $100 • Maximum: $1,000,000
                </p>
              </div>

              <Alert className="bg-background/50">
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Paper trading simulates real market conditions using virtual money.
                  This is perfect for testing your strategy before committing real capital.
                  You can switch to live trading at any time after closing all positions.
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </>
      )}

      {/* Live Trading Info */}
      {isLiveMode && (
        <>
          <Separator />

          <div className="space-y-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-red-600 dark:text-red-400" />
              <h4 className="font-semibold">Live Trading Active</h4>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                This strategy will execute real trades on Polymarket using your connected wallet.
              </p>
              <ul className="ml-4 list-disc space-y-1">
                <li>All trades will use real USDC</li>
                <li>Position sizing follows your configured rules</li>
                <li>Trades are irreversible once executed</li>
                <li>Gas fees apply to all transactions</li>
              </ul>
            </div>

            <Alert className="bg-background/50">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <strong>Risk Warning:</strong> Trading involves substantial risk of loss.
                Only trade with capital you can afford to lose.
              </AlertDescription>
            </Alert>
          </div>
        </>
      )}
    </div>
  );
}
