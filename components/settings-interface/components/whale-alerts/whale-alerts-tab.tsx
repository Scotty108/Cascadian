'use client';

import type React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsSelect } from '../shared/settings-select';
import { SettingsToggle } from '../shared/settings-toggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Waves, TrendingUp, ArrowLeftRight, Activity, Target, Eye } from 'lucide-react';
import type { WhaleActivitySettings } from '../../types';

interface WhaleAlertsTabProps {
  whaleActivity: WhaleActivitySettings;
  onWhaleActivityChange: (updates: Partial<WhaleActivitySettings>) => void;
}

export const WhaleAlertsTab: React.FC<WhaleAlertsTabProps> = ({ whaleActivity, onWhaleActivityChange }) => {
  const handlePositionAlertsChange = (key: keyof WhaleActivitySettings['positionAlerts'], value: any) => {
    onWhaleActivityChange({
      positionAlerts: { ...whaleActivity.positionAlerts, [key]: value },
    });
  };

  const handleTradeAlertsChange = (key: keyof WhaleActivitySettings['tradeAlerts'], value: any) => {
    onWhaleActivityChange({
      tradeAlerts: { ...whaleActivity.tradeAlerts, [key]: value },
    });
  };

  const handleFlipAlertsChange = (key: keyof WhaleActivitySettings['flipAlerts'], value: any) => {
    onWhaleActivityChange({
      flipAlerts: { ...whaleActivity.flipAlerts, [key]: value },
    });
  };

  const handleFlowAlertsChange = (key: keyof WhaleActivitySettings['flowAlerts'], value: any) => {
    onWhaleActivityChange({
      flowAlerts: { ...whaleActivity.flowAlerts, [key]: value },
    });
  };

  const handleConcentrationAlertsChange = (key: keyof WhaleActivitySettings['concentrationAlerts'], value: any) => {
    onWhaleActivityChange({
      concentrationAlerts: { ...whaleActivity.concentrationAlerts, [key]: value },
    });
  };

  const handleDisplayChange = (key: keyof WhaleActivitySettings['displayPreferences'], value: any) => {
    onWhaleActivityChange({
      displayPreferences: { ...whaleActivity.displayPreferences, [key]: value },
    });
  };

  const categories = ['Politics', 'Sports', 'Crypto', 'Finance', 'PopCulture', 'Tech'];

  const timeframeOptions = [
    { value: '24h', label: 'Last 24 Hours' },
    { value: '7d', label: 'Last 7 Days' },
    { value: '30d', label: 'Last 30 Days' },
    { value: '90d', label: 'Last 90 Days' },
    { value: 'all', label: 'All Time' },
  ];

  const sortByOptions = [
    { value: 'size', label: 'Position Size' },
    { value: 'pnl', label: 'P&L' },
    { value: 'entry', label: 'Entry Date' },
    { value: 'updated', label: 'Last Updated' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Whale Activity Alerts</h2>
        <p className="text-muted-foreground">
          Configure alerts for whale positions, trades, and unusual activity
        </p>
      </div>

      {/* Position Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Waves className="h-5 w-5" />
            <span>Position Alerts</span>
          </CardTitle>
          <CardDescription>Get notified when whales enter or exit large positions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="position-alerts-enabled"
            label="Enable Position Alerts"
            description="Receive alerts for whale position changes"
            checked={whaleActivity.positionAlerts.enabled}
            onCheckedChange={(checked) => handlePositionAlertsChange('enabled', checked)}
          />

          {whaleActivity.positionAlerts.enabled && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-position-size">Minimum Position Size ($)</Label>
                  <Input
                    id="min-position-size"
                    type="number"
                    value={whaleActivity.positionAlerts.minPositionSize}
                    onChange={(e) => handlePositionAlertsChange('minPositionSize', Number(e.target.value))}
                    placeholder="50000"
                    min="0"
                    step="10000"
                  />
                  <p className="text-xs text-muted-foreground">Alert only for positions above this threshold</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="min-pnl-change">Minimum P&L Change (%)</Label>
                  <Input
                    id="min-pnl-change"
                    type="number"
                    value={whaleActivity.positionAlerts.minPnlChange}
                    onChange={(e) => handlePositionAlertsChange('minPnlChange', Number(e.target.value))}
                    placeholder="10"
                    min="0"
                    max="100"
                    step="5"
                  />
                  <p className="text-xs text-muted-foreground">Alert when position P&L changes by this amount</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="min-sws-score">Minimum Smart Whale Score</Label>
                  <Input
                    id="min-sws-score"
                    type="number"
                    value={whaleActivity.positionAlerts.minSwsScore}
                    onChange={(e) => handlePositionAlertsChange('minSwsScore', Number(e.target.value))}
                    placeholder="7.0"
                    min="0"
                    max="10"
                    step="0.5"
                  />
                  <p className="text-xs text-muted-foreground">
                    Only alert for whales with SWS score above this (Pro feature)
                  </p>
                </div>
              </div>

              <SettingsToggle
                id="smart-whales-only-position"
                label="Smart Whales Only"
                description="Only alert for verified smart whales"
                checked={whaleActivity.positionAlerts.smartWhalesOnly}
                onCheckedChange={(checked) => handlePositionAlertsChange('smartWhalesOnly', checked)}
              />

              <div className="space-y-2">
                <Label>Watched Categories</Label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Badge
                      key={category}
                      variant={
                        whaleActivity.positionAlerts.watchedCategories.includes(category) ? 'default' : 'outline'
                      }
                      className="cursor-pointer"
                      onClick={() => {
                        const watchedCategories = whaleActivity.positionAlerts.watchedCategories.includes(category)
                          ? whaleActivity.positionAlerts.watchedCategories.filter((c) => c !== category)
                          : [...whaleActivity.positionAlerts.watchedCategories, category];
                        handlePositionAlertsChange('watchedCategories', watchedCategories);
                      }}
                    >
                      {category}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  Select categories to watch. Leave empty to watch all categories.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Trade Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5" />
            <span>Trade Alerts</span>
          </CardTitle>
          <CardDescription>Get notified about whale trades in real-time</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="trade-alerts-enabled"
            label="Enable Trade Alerts"
            description="Receive alerts for whale trades"
            checked={whaleActivity.tradeAlerts.enabled}
            onCheckedChange={(checked) => handleTradeAlertsChange('enabled', checked)}
          />

          {whaleActivity.tradeAlerts.enabled && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-trade-size">Minimum Trade Size ($)</Label>
                  <Input
                    id="min-trade-size"
                    type="number"
                    value={whaleActivity.tradeAlerts.minTradeSize}
                    onChange={(e) => handleTradeAlertsChange('minTradeSize', Number(e.target.value))}
                    placeholder="10000"
                    min="0"
                    step="5000"
                  />
                  <p className="text-xs text-muted-foreground">Alert only for trades above this threshold</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="price-impact-threshold">Price Impact Threshold (bps)</Label>
                  <Input
                    id="price-impact-threshold"
                    type="number"
                    value={whaleActivity.tradeAlerts.priceImpactThreshold}
                    onChange={(e) => handleTradeAlertsChange('priceImpactThreshold', Number(e.target.value))}
                    placeholder="50"
                    min="0"
                    step="10"
                  />
                  <p className="text-xs text-muted-foreground">Alert when trade moves price by this many basis points</p>
                </div>
              </div>

              <SettingsToggle
                id="unusual-only"
                label="Unusual Trades Only"
                description="Only alert for trades with unusual characteristics"
                checked={whaleActivity.tradeAlerts.unusualOnly}
                onCheckedChange={(checked) => handleTradeAlertsChange('unusualOnly', checked)}
              />

              <SettingsToggle
                id="smart-whales-only-trade"
                label="Smart Whales Only"
                description="Only alert for verified smart whales"
                checked={whaleActivity.tradeAlerts.smartWhalesOnly}
                onCheckedChange={(checked) => handleTradeAlertsChange('smartWhalesOnly', checked)}
              />

              <div className="space-y-2">
                <Label>Watched Categories</Label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Badge
                      key={category}
                      variant={whaleActivity.tradeAlerts.watchedCategories.includes(category) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => {
                        const watchedCategories = whaleActivity.tradeAlerts.watchedCategories.includes(category)
                          ? whaleActivity.tradeAlerts.watchedCategories.filter((c) => c !== category)
                          : [...whaleActivity.tradeAlerts.watchedCategories, category];
                        handleTradeAlertsChange('watchedCategories', watchedCategories);
                      }}
                    >
                      {category}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Flip Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <ArrowLeftRight className="h-5 w-5" />
            <span>Position Flip Alerts</span>
          </CardTitle>
          <CardDescription>Get notified when whales switch from YES to NO or vice versa</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="flip-alerts-enabled"
            label="Enable Flip Alerts"
            description="Receive alerts when whales flip positions"
            checked={whaleActivity.flipAlerts.enabled}
            onCheckedChange={(checked) => handleFlipAlertsChange('enabled', checked)}
          />

          {whaleActivity.flipAlerts.enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="flip-min-position-size">Minimum Position Size ($)</Label>
                <Input
                  id="flip-min-position-size"
                  type="number"
                  value={whaleActivity.flipAlerts.minPositionSize}
                  onChange={(e) => handleFlipAlertsChange('minPositionSize', Number(e.target.value))}
                  placeholder="25000"
                  min="0"
                  step="5000"
                />
                <p className="text-xs text-muted-foreground">Only alert for flips on positions above this size</p>
              </div>

              <SettingsToggle
                id="flip-smart-whales-only"
                label="Smart Whales Only"
                description="Only alert for verified smart whales flipping positions"
                checked={whaleActivity.flipAlerts.smartWhalesOnly}
                onCheckedChange={(checked) => handleFlipAlertsChange('smartWhalesOnly', checked)}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Flow Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Activity className="h-5 w-5" />
            <span>Flow Alerts</span>
          </CardTitle>
          <CardDescription>Get notified about buy/sell volume shifts and sentiment changes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="flow-alerts-enabled"
            label="Enable Flow Alerts"
            description="Receive alerts for whale flow changes"
            checked={whaleActivity.flowAlerts.enabled}
            onCheckedChange={(checked) => handleFlowAlertsChange('enabled', checked)}
          />

          {whaleActivity.flowAlerts.enabled && (
            <>
              <SettingsToggle
                id="sentiment-change"
                label="Sentiment Change Alerts"
                description="Alert when whale sentiment shifts from bullish to bearish or vice versa"
                checked={whaleActivity.flowAlerts.sentimentChange}
                onCheckedChange={(checked) => handleFlowAlertsChange('sentimentChange', checked)}
              />

              <div className="space-y-2">
                <Label htmlFor="volume-threshold">Volume Threshold ($)</Label>
                <Input
                  id="volume-threshold"
                  type="number"
                  value={whaleActivity.flowAlerts.volumeThreshold}
                  onChange={(e) => handleFlowAlertsChange('volumeThreshold', Number(e.target.value))}
                  placeholder="100000"
                  min="0"
                  step="10000"
                />
                <p className="text-xs text-muted-foreground">Alert when flow volume exceeds this threshold</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Concentration Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Target className="h-5 w-5" />
            <span>Concentration Alerts</span>
          </CardTitle>
          <CardDescription>Get notified about high market concentration by whales</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="concentration-alerts-enabled"
            label="Enable Concentration Alerts"
            description="Receive alerts for high whale concentration in markets"
            checked={whaleActivity.concentrationAlerts.enabled}
            onCheckedChange={(checked) => handleConcentrationAlertsChange('enabled', checked)}
          />

          {whaleActivity.concentrationAlerts.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="herfindahl-threshold">Herfindahl Index Threshold</Label>
                <Input
                  id="herfindahl-threshold"
                  type="number"
                  value={whaleActivity.concentrationAlerts.herfindahlThreshold}
                  onChange={(e) => handleConcentrationAlertsChange('herfindahlThreshold', Number(e.target.value))}
                  placeholder="0.15"
                  min="0"
                  max="1"
                  step="0.05"
                />
                <p className="text-xs text-muted-foreground">Alert when market concentration exceeds this (0-1 scale)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="whale-share-threshold">Whale Share Threshold (%)</Label>
                <Input
                  id="whale-share-threshold"
                  type="number"
                  value={whaleActivity.concentrationAlerts.whaleShareThreshold}
                  onChange={(e) => handleConcentrationAlertsChange('whaleShareThreshold', Number(e.target.value))}
                  placeholder="50"
                  min="0"
                  max="100"
                  step="5"
                />
                <p className="text-xs text-muted-foreground">Alert when whales control this % of market</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Display Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Eye className="h-5 w-5" />
            <span>Display Preferences</span>
          </CardTitle>
          <CardDescription>Customize how whale activity data is displayed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SettingsSelect
              id="default-timeframe"
              label="Default Timeframe"
              description="Default time range for whale activity views"
              value={whaleActivity.displayPreferences.defaultTimeframe}
              onValueChange={(value) => handleDisplayChange('defaultTimeframe', value)}
              options={timeframeOptions}
            />

            <SettingsSelect
              id="default-sort-by"
              label="Default Sort By"
              description="Default sort order for whale positions"
              value={whaleActivity.displayPreferences.defaultSortBy}
              onValueChange={(value) => handleDisplayChange('defaultSortBy', value)}
              options={sortByOptions}
            />

            <div className="space-y-2">
              <Label htmlFor="refresh-interval">Auto-Refresh Interval (seconds)</Label>
              <Input
                id="refresh-interval"
                type="number"
                value={whaleActivity.displayPreferences.refreshInterval}
                onChange={(e) => handleDisplayChange('refreshInterval', Number(e.target.value))}
                placeholder="30"
                min="10"
                max="300"
                step="10"
                disabled={!whaleActivity.displayPreferences.autoRefreshEnabled}
              />
            </div>
          </div>

          <SettingsToggle
            id="auto-refresh"
            label="Auto-Refresh Enabled"
            description="Automatically refresh whale activity data"
            checked={whaleActivity.displayPreferences.autoRefreshEnabled}
            onCheckedChange={(checked) => handleDisplayChange('autoRefreshEnabled', checked)}
          />

          <SettingsToggle
            id="show-advanced-metrics"
            label="Show Advanced Metrics"
            description="Display SWS scores and other Pro features (requires Pro subscription)"
            checked={whaleActivity.displayPreferences.showAdvancedMetrics}
            onCheckedChange={(checked) => handleDisplayChange('showAdvancedMetrics', checked)}
          />
        </CardContent>
      </Card>
    </div>
  );
};
