/**
 * STRATEGY SETTINGS DIALOG
 *
 * Modal dialog for configuring strategy-level settings:
 * - Strategy name
 * - Trading mode (paper vs live)
 * - Paper trading bankroll
 * - Execution schedule (future)
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import TradingModeSettings, { type TradingModeConfig } from './trading-mode-settings';
import { Settings } from 'lucide-react';

export interface StrategySettings {
  strategy_name: string;
  trading_mode: 'paper' | 'live';
  paper_bankroll_usd: number;
}

interface StrategySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: StrategySettings;
  onSave: (settings: StrategySettings) => void;
  hasOpenPositions?: boolean;
}

export default function StrategySettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
  hasOpenPositions = false,
}: StrategySettingsDialogProps) {
  const [localSettings, setLocalSettings] = useState<StrategySettings>(settings);

  // Sync with external settings when dialog opens
  useEffect(() => {
    if (open) {
      setLocalSettings(settings);
    }
  }, [open, settings]);

  const handleTradingModeChange = (config: TradingModeConfig) => {
    setLocalSettings({
      ...localSettings,
      trading_mode: config.trading_mode,
      paper_bankroll_usd: config.paper_bankroll_usd,
    });
  };

  const handleSave = () => {
    onSave(localSettings);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setLocalSettings(settings); // Reset to original
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            <DialogTitle>Strategy Settings</DialogTitle>
          </div>
          <DialogDescription>
            Configure settings for your trading strategy
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Strategy Name */}
          <div className="space-y-2">
            <Label htmlFor="strategy-name" className="text-sm font-semibold">
              Strategy Name
            </Label>
            <Input
              id="strategy-name"
              placeholder="Enter strategy name..."
              value={localSettings.strategy_name}
              onChange={(e) => setLocalSettings({ ...localSettings, strategy_name: e.target.value })}
            />
          </div>

          <Separator />

          {/* Trading Mode Settings */}
          <TradingModeSettings
            config={{
              trading_mode: localSettings.trading_mode,
              paper_bankroll_usd: localSettings.paper_bankroll_usd,
            }}
            onChange={handleTradingModeChange}
            hasOpenPositions={hasOpenPositions}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
