/**
 * ORCHESTRATOR CONFIGURATION PANEL
 *
 * Task Group 14.3: Side panel for orchestrator configuration
 * - Basic Settings: Mode toggle, portfolio size, risk tolerance
 * - Position Sizing Rules section
 * - Advanced settings section
 * - Save/Cancel buttons
 * - Real-time validation feedback
 */

"use client"

import React, { useState, useMemo } from 'react';
import { X, Save, AlertCircle, CheckCircle, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
