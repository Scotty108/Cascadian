/**
 * ORCHESTRATOR CONFIGURATION PANEL
 *
 * Task Group 14.3: Side panel for orchestrator configuration
 * - Basic Settings: Mode toggle, portfolio size, risk tolerance
 * - Position Sizing Rules section
 * - Copy Trading Configuration section (NEW)
 * - Advanced settings section
 * - Save/Cancel buttons
 * - Real-time validation feedback
 */

"use client"

import React, { useState, useMemo } from 'react';
import { X, Save, AlertCircle, CheckCircle, Shield, Radio, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RiskToleranceSlider from './risk-tolerance-slider';
import PositionSizingRules from './position-sizing-rules';
import type { OrchestratorConfig } from '@/lib/strategy-builder/types';

interface OrchestratorConfigPanelProps {
  nodeId: string;
  config: OrchestratorConfig;
  onSave: (nodeId: string, data: { config: OrchestratorConfig }) => void;
  onClose: () => void;
}

export default function OrchestratorConfigPanel({
  nodeId,
  config,
  onSave,
  onClose,
}: OrchestratorConfigPanelProps) {
  const [localConfig, setLocalConfig] = useState<OrchestratorConfig>(config);

  // Calculate Kelly lambda from risk tolerance
  const calculateKellyLambda = (riskTolerance: number): number => {
    if (riskTolerance <= 3) {
      return 0.10 + ((riskTolerance - 1) / 2) * 0.15;
    } else if (riskTolerance <= 7) {
      return 0.25 + ((riskTolerance - 4) / 3) * 0.25;
    } else {
      return 0.50 + ((riskTolerance - 8) / 2) * 0.50;
    }
  };

  // Update Kelly lambda when risk tolerance changes
  const handleRiskToleranceChange = (newRiskTolerance: number) => {
    const newLambda = calculateKellyLambda(newRiskTolerance);
    setLocalConfig({
      ...localConfig,
      risk_tolerance: newRiskTolerance,
      position_sizing_rules: {
        ...localConfig.position_sizing_rules,
        fractional_kelly_lambda: newLambda,
      },
    });
  };

  const handleModeChange = (mode: 'autonomous' | 'approval') => {
    setLocalConfig({
      ...localConfig,
      mode,
    });
  };

  const handlePortfolioSizeChange = (portfolioSize: number) => {
    setLocalConfig({
      ...localConfig,
      portfolio_size_usd: portfolioSize,
    });
  };

  const handlePositionSizingChange = (positionSizingRules: OrchestratorConfig['position_sizing_rules']) => {
    setLocalConfig({
      ...localConfig,
      position_sizing_rules: positionSizingRules,
    });
  };

  // Copy trading handlers
  const handleCopyTradingEnabledChange = (enabled: boolean) => {
    setLocalConfig({
      ...localConfig,
      copy_trading: enabled
        ? {
            enabled: true,
            poll_interval_seconds: 60,
            owrr_thresholds: {
              min_yes: 0.65,
              min_no: 0.60,
              min_confidence: 'medium',
            },
            max_latency_seconds: 120,
          }
        : undefined,
    });
  };

  const handleCopyTradingChange = (key: string, value: any) => {
    if (!localConfig.copy_trading) return;

    setLocalConfig({
      ...localConfig,
      copy_trading: {
        ...localConfig.copy_trading,
        [key]: value,
      },
    });
  };

  const handleCopyTradingThresholdChange = (key: string, value: any) => {
    if (!localConfig.copy_trading) return;

    setLocalConfig({
      ...localConfig,
      copy_trading: {
        ...localConfig.copy_trading,
        owrr_thresholds: {
          ...localConfig.copy_trading.owrr_thresholds,
          [key]: value,
        },
      },
    });
  };

  // Validation
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!localConfig.portfolio_size_usd || localConfig.portfolio_size_usd <= 0) {
      errors.push('Portfolio size must be greater than 0');
    }

    if (localConfig.position_sizing_rules.min_bet >= localConfig.position_sizing_rules.max_bet) {
      errors.push('Min bet must be less than max bet');
    }

    if (localConfig.position_sizing_rules.min_bet < 1) {
      errors.push('Min bet must be at least $1');
    }

    if (localConfig.position_sizing_rules.max_bet > localConfig.portfolio_size_usd) {
      warnings.push('Max bet exceeds portfolio size');
    }

    const maxPositionValue = localConfig.portfolio_size_usd * localConfig.position_sizing_rules.max_per_position;
    if (maxPositionValue < localConfig.position_sizing_rules.min_bet) {
      errors.push('Max % per position is too small for min bet size');
    }

    if (localConfig.risk_tolerance >= 8 && localConfig.position_sizing_rules.max_per_position > 0.10) {
      warnings.push('Aggressive risk tolerance with high position size may be risky');
    }

    // Copy trading validation
    if (localConfig.copy_trading?.enabled) {
      if (localConfig.copy_trading.owrr_thresholds.min_yes < 0.5 || localConfig.copy_trading.owrr_thresholds.min_yes > 1) {
        warnings.push('YES OWRR threshold should be between 0.5 and 1.0');
      }
      if (localConfig.copy_trading.owrr_thresholds.min_no < 0.5 || localConfig.copy_trading.owrr_thresholds.min_no > 1) {
        warnings.push('NO OWRR threshold should be between 0.5 and 1.0');
      }
      if (localConfig.copy_trading.max_latency_seconds < 30) {
        warnings.push('Very low latency threshold may miss most trades');
      }
    }

    const isValid = errors.length === 0;

    return { isValid, errors, warnings };
  }, [localConfig]);

  const handleSave = () => {
    if (validation.isValid) {
      onSave(nodeId, { config: localConfig });
      onClose();
    }
  };

  return (
    <div className="flex h-full w-[500px] flex-col border-l border-border/40 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-500/20 p-2">
            <Shield className="h-5 w-5 text-violet-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Portfolio Orchestrator</h3>
            <p className="text-sm text-muted-foreground">
              AI-powered position sizing with Kelly criterion
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-6">
          {/* Basic Settings */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-foreground">Basic Settings</h4>

            {/* Operating Mode */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Operating Mode</Label>
              <div className="flex gap-2">
                <Button
                  variant={localConfig.mode === 'autonomous' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleModeChange('autonomous')}
                  className={`flex-1 ${
                    localConfig.mode === 'autonomous'
                      ? 'bg-green-500 text-white hover:bg-green-600'
                      : 'hover:border-green-500/50 hover:bg-green-500/5'
                  }`}
                >
                  Autonomous
                </Button>
                <Button
                  variant={localConfig.mode === 'approval' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleModeChange('approval')}
                  className={`flex-1 ${
                    localConfig.mode === 'approval'
                      ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                      : 'hover:border-yellow-500/50 hover:bg-yellow-500/5'
                  }`}
                >
                  Approval Required
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {localConfig.mode === 'autonomous'
                  ? 'AI will execute decisions automatically'
                  : 'AI will wait for your approval before executing'}
              </p>
            </div>

            {/* Portfolio Size */}
            <div className="space-y-2">
              <Label htmlFor="portfolio-size" className="text-sm font-semibold">
                Portfolio Size (USD)
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  id="portfolio-size"
                  type="number"
                  min={1}
                  value={localConfig.portfolio_size_usd}
                  onChange={(e) => handlePortfolioSizeChange(Number(e.target.value))}
                  className="pl-7"
                  placeholder="10000"
                />
              </div>
            </div>

            {/* Risk Tolerance */}
            <RiskToleranceSlider
              value={localConfig.risk_tolerance}
              onChange={handleRiskToleranceChange}
            />
          </div>

          <Separator />

          {/* Position Sizing Rules */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-foreground">Position Sizing Rules</h4>
            <PositionSizingRules
              config={localConfig.position_sizing_rules}
              onChange={handlePositionSizingChange}
            />
          </div>

          <Separator />

          {/* Copy Trading Configuration */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-[#00E0AA]/20 p-1.5">
                <Zap className="h-4 w-4 text-[#00E0AA]" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-foreground">Copy Trading</h4>
                <p className="text-xs text-muted-foreground">
                  Automatically copy trades from tracked wallets
                </p>
              </div>
              <Switch
                checked={localConfig.copy_trading?.enabled || false}
                onCheckedChange={handleCopyTradingEnabledChange}
              />
            </div>

            {localConfig.copy_trading?.enabled && (
              <div className="space-y-4 rounded-lg border border-[#00E0AA]/20 bg-[#00E0AA]/5 p-4">
                {/* Poll Interval */}
                <div className="space-y-2">
                  <Label htmlFor="poll-interval" className="text-sm font-semibold flex items-center gap-2">
                    <Radio className="h-3.5 w-3.5 text-[#00E0AA]" />
                    Poll Interval
                  </Label>
                  <Select
                    value={String(localConfig.copy_trading.poll_interval_seconds)}
                    onValueChange={(value) => handleCopyTradingChange('poll_interval_seconds', Number(value))}
                  >
                    <SelectTrigger id="poll-interval">
                      <SelectValue placeholder="Select interval" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 seconds (Fast)</SelectItem>
                      <SelectItem value="60">1 minute (Balanced)</SelectItem>
                      <SelectItem value="120">2 minutes (Conservative)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    How often to check for new trades from tracked wallets
                  </p>
                </div>

                {/* Max Latency */}
                <div className="space-y-2">
                  <Label htmlFor="max-latency" className="text-sm font-semibold">
                    Max Latency (seconds)
                  </Label>
                  <Input
                    id="max-latency"
                    type="number"
                    min={30}
                    max={300}
                    value={localConfig.copy_trading.max_latency_seconds}
                    onChange={(e) => handleCopyTradingChange('max_latency_seconds', Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Skip trades older than this threshold (30-300 seconds)
                  </p>
                </div>

                {/* OWRR Thresholds */}
                <div className="space-y-3">
                  <Label className="text-sm font-semibold">OWRR Thresholds</Label>
                  <div className="space-y-3 rounded-md border border-border/50 bg-background/50 p-3">
                    <div className="space-y-2">
                      <Label htmlFor="owrr-yes" className="text-xs font-medium text-muted-foreground">
                        Min OWRR for YES trades
                      </Label>
                      <Input
                        id="owrr-yes"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={localConfig.copy_trading.owrr_thresholds.min_yes}
                        onChange={(e) => handleCopyTradingThresholdChange('min_yes', Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="owrr-no" className="text-xs font-medium text-muted-foreground">
                        Min OWRR for NO trades
                      </Label>
                      <Input
                        id="owrr-no"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={localConfig.copy_trading.owrr_thresholds.min_no}
                        onChange={(e) => handleCopyTradingThresholdChange('min_no', Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="min-confidence" className="text-xs font-medium text-muted-foreground">
                        Min Confidence
                      </Label>
                      <Select
                        value={localConfig.copy_trading.owrr_thresholds.min_confidence}
                        onValueChange={(value: 'high' | 'medium' | 'low') =>
                          handleCopyTradingThresholdChange('min_confidence', value)
                        }
                      >
                        <SelectTrigger id="min-confidence">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">High (5+ qualified wallets)</SelectItem>
                          <SelectItem value="medium">Medium (3+ qualified wallets)</SelectItem>
                          <SelectItem value="low">Low (1+ qualified wallets)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only copy trades that meet smart money consensus criteria
                  </p>
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Summary */}
          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Configuration Summary</h4>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Mode:</span>
                <span className="font-semibold">{localConfig.mode === 'autonomous' ? 'Autonomous' : 'Approval Required'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Portfolio Size:</span>
                <span className="font-semibold">${localConfig.portfolio_size_usd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Risk Level:</span>
                <span className="font-semibold">{localConfig.risk_tolerance}/10</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Kelly Fraction:</span>
                <span className="font-semibold">{(localConfig.position_sizing_rules?.fractional_kelly_lambda ?? 0.25).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Per Position:</span>
                <span className="font-semibold">{Math.round((localConfig.position_sizing_rules?.max_per_position ?? 0.05) * 100)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bet Range:</span>
                <span className="font-semibold">${localConfig.position_sizing_rules?.min_bet ?? 5} - ${localConfig.position_sizing_rules?.max_bet ?? 500}</span>
              </div>
              {localConfig.copy_trading?.enabled && (
                <>
                  <Separator className="my-2" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Copy Trading:</span>
                    <span className="font-semibold text-[#00E0AA]">Enabled</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Poll Interval:</span>
                    <span className="font-semibold">{localConfig.copy_trading.poll_interval_seconds}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Latency:</span>
                    <span className="font-semibold">{localConfig.copy_trading.max_latency_seconds}s</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Validation Feedback */}
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="space-y-2">
              {validation.errors.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                        Validation Errors
                      </p>
                      <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
                        {validation.errors.map((error, index) => (
                          <li key={index}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {validation.warnings.length > 0 && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">
                        Warnings
                      </p>
                      <ul className="text-xs text-yellow-600 dark:text-yellow-300 space-y-1">
                        {validation.warnings.map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Success Indicator */}
          {validation.isValid && validation.warnings.length === 0 && (
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <p className="text-sm text-green-700 dark:text-green-400">
                  Configuration is valid and ready to save
                </p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-border/40 p-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={!validation.isValid}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          Save Configuration
        </Button>
      </div>
    </div>
  );
}
