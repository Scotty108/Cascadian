/**
 * POSITION SIZING RULES COMPONENT
 *
 * Task Group 14.4: Form inputs for position sizing configuration
 * - Max % per position slider
 * - Min/max bet size inputs
 * - Portfolio heat limit slider
 * - Risk-reward ratio threshold
 * - Drawdown protection settings
 * - All inputs with labels, tooltips, validation
 */

"use client"

import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Info } from 'lucide-react';
import type { OrchestratorConfig } from '@/lib/strategy-builder/types';

interface PositionSizingRulesProps {
  config: OrchestratorConfig['position_sizing_rules'];
  onChange: (config: OrchestratorConfig['position_sizing_rules']) => void;
}

export default function PositionSizingRules({ config, onChange }: PositionSizingRulesProps) {
  // Ensure default structure exists for legacy configs
  const safeConfig = {
    ...config,
    drawdown_protection: config.drawdown_protection || {
      enabled: false,
      drawdown_threshold: 0.10,
      size_reduction: 0.50,
    },
    volatility_adjustment: config.volatility_adjustment || {
      enabled: false,
    },
  };

  const handleChange = (field: string, value: any) => {
    onChange({
      ...safeConfig,
      [field]: value,
    });
  };

  const handleDrawdownChange = (field: string, value: any) => {
    onChange({
      ...safeConfig,
      drawdown_protection: {
        ...safeConfig.drawdown_protection,
        [field]: value,
      },
    });
  };

  const handleVolatilityChange = (field: string, value: any) => {
    onChange({
      ...safeConfig,
      volatility_adjustment: {
        ...safeConfig.volatility_adjustment,
        [field]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Max Per Position */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label htmlFor="max-per-position" className="text-sm font-semibold">
              Max % Per Position
            </Label>
            <span title="Maximum portfolio allocation to a single position">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </div>
          <span className="text-sm font-bold text-violet-600 dark:text-violet-400">
            {Math.round(safeConfig.max_per_position * 100)}%
          </span>
        </div>
        <Slider
          id="max-per-position"
          min={0.01}
          max={0.20}
          step={0.01}
          value={[safeConfig.max_per_position]}
          onValueChange={([value]) => handleChange('max_per_position', value)}
        />
        <p className="text-xs text-muted-foreground">
          Range: 1% - 20% of portfolio
        </p>
      </div>

      <Separator />

      {/* Min and Max Bet Size */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="min-bet" className="text-sm font-semibold">
              Min Bet Size
            </Label>
            <span title="Minimum bet size in USD">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              id="min-bet"
              type="number"
              min={1}
              max={safeConfig.max_bet}
              value={safeConfig.min_bet}
              onChange={(e) => handleChange('min_bet', Number(e.target.value))}
              className="pl-7"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="max-bet" className="text-sm font-semibold">
              Max Bet Size
            </Label>
            <span title="Maximum bet size in USD">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input
              id="max-bet"
              type="number"
              min={safeConfig.min_bet}
              value={safeConfig.max_bet}
              onChange={(e) => handleChange('max_bet', Number(e.target.value))}
              className="pl-7"
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Portfolio Heat Limit */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label htmlFor="portfolio-heat" className="text-sm font-semibold">
              Portfolio Heat Limit
            </Label>
            <span title="Maximum total exposure across all positions">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </div>
          <span className="text-sm font-bold text-violet-600 dark:text-violet-400">
            {Math.round(safeConfig.portfolio_heat_limit * 100)}%
          </span>
        </div>
        <Slider
          id="portfolio-heat"
          min={0.10}
          max={1.0}
          step={0.05}
          value={[safeConfig.portfolio_heat_limit]}
          onValueChange={([value]) => handleChange('portfolio_heat_limit', value)}
        />
        <p className="text-xs text-muted-foreground">
          Range: 10% - 100% of portfolio
        </p>
      </div>

      <Separator />

      {/* Risk-Reward Threshold */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="risk-reward" className="text-sm font-semibold">
            Risk/Reward Ratio Threshold
          </Label>
          <span title="Minimum acceptable risk/reward ratio">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </div>
        <Input
          id="risk-reward"
          type="number"
          min={1.0}
          max={10.0}
          step={0.1}
          value={safeConfig.risk_reward_threshold}
          onChange={(e) => handleChange('risk_reward_threshold', Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Range: 1.0 - 10.0 (higher = more selective)
        </p>
      </div>

      <Separator />

      {/* Drawdown Protection */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Label htmlFor="drawdown-enabled" className="text-sm font-semibold">
              Drawdown Protection
            </Label>
            <span title="Reduce bet sizes during drawdowns">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </div>
          <Switch
            id="drawdown-enabled"
            checked={safeConfig.drawdown_protection.enabled}
            onCheckedChange={(checked) => handleDrawdownChange('enabled', checked)}
          />
        </div>

        {safeConfig.drawdown_protection.enabled && (
          <div className="ml-4 space-y-4 rounded-lg border border-violet-500/20 bg-violet-500/5 p-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="drawdown-threshold" className="text-sm">
                  Drawdown Threshold
                </Label>
                <span title="Trigger protection at this drawdown %">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </div>
              <div className="relative">
                <Input
                  id="drawdown-threshold"
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={Math.round(safeConfig.drawdown_protection.drawdown_threshold * 100)}
                  onChange={(e) => handleDrawdownChange('drawdown_threshold', Number(e.target.value) / 100)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="size-reduction" className="text-sm">
                  Bet Size Reduction
                </Label>
                <span title="Reduce bet sizes by this %">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </div>
              <div className="relative">
                <Input
                  id="size-reduction"
                  type="number"
                  min={10}
                  max={90}
                  step={5}
                  value={Math.round(safeConfig.drawdown_protection.size_reduction * 100)}
                  onChange={(e) => handleDrawdownChange('size_reduction', Number(e.target.value) / 100)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Volatility Adjustment */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label htmlFor="volatility-enabled" className="text-sm font-semibold">
            Volatility Adjustment
          </Label>
          <span title="Adjust bet sizes based on market volatility">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </div>
        <Switch
          id="volatility-enabled"
          checked={safeConfig.volatility_adjustment.enabled}
          onCheckedChange={(checked) => handleVolatilityChange('enabled', checked)}
        />
      </div>
      {safeConfig.volatility_adjustment.enabled && (
        <p className="text-xs text-muted-foreground ml-4">
          Position sizes will automatically adjust based on detected market volatility patterns.
        </p>
      )}
    </div>
  );
}
