'use client';

import type React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsSelect } from '../shared/settings-select';
import { SettingsToggle } from '../shared/settings-toggle';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Eye, Users, Clock, BarChart, FileText, Settings } from 'lucide-react';
import type { InsiderDetectionSettings } from '../../types';

interface InsiderAlertsTabProps {
  insiderDetection: InsiderDetectionSettings;
  onInsiderDetectionChange: (updates: Partial<InsiderDetectionSettings>) => void;
}

export const InsiderAlertsTab: React.FC<InsiderAlertsTabProps> = ({
  insiderDetection,
  onInsiderDetectionChange,
}) => {
  const handleAlertThresholdsChange = (key: keyof InsiderDetectionSettings['alertThresholds'], value: any) => {
    onInsiderDetectionChange({
      alertThresholds: { ...insiderDetection.alertThresholds, [key]: value },
    });
  };

  const handleMarketWatchChange = (key: keyof InsiderDetectionSettings['marketWatch'], value: any) => {
    onInsiderDetectionChange({
      marketWatch: { ...insiderDetection.marketWatch, [key]: value },
    });
  };

  const handleClusterDetectionChange = (key: keyof InsiderDetectionSettings['clusterDetection'], value: any) => {
    onInsiderDetectionChange({
      clusterDetection: { ...insiderDetection.clusterDetection, [key]: value },
    });
  };

  const handleTimingAnomaliesChange = (key: keyof InsiderDetectionSettings['timingAnomalies'], value: any) => {
    onInsiderDetectionChange({
      timingAnomalies: { ...insiderDetection.timingAnomalies, [key]: value },
    });
  };

  const handleVolumeAnomaliesChange = (key: keyof InsiderDetectionSettings['volumeAnomalies'], value: any) => {
    onInsiderDetectionChange({
      volumeAnomalies: { ...insiderDetection.volumeAnomalies, [key]: value },
    });
  };

  const handleComplianceChange = (key: keyof InsiderDetectionSettings['complianceSettings'], value: any) => {
    onInsiderDetectionChange({
      complianceSettings: { ...insiderDetection.complianceSettings, [key]: value },
    });
  };

  const handleDisplayChange = (key: keyof InsiderDetectionSettings['displayPreferences'], value: any) => {
    onInsiderDetectionChange({
      displayPreferences: { ...insiderDetection.displayPreferences, [key]: value },
    });
  };

  const categories = ['Politics', 'Sports', 'Crypto', 'Finance', 'PopCulture', 'Tech'];
  const riskLevels: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
  const priorityLevels: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
  const connectionTypes: ('funding' | 'trading' | 'timing')[] = ['funding', 'trading', 'timing'];

  const exportFrequencyOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];

  const exportFormatOptions = [
    { value: 'csv', label: 'CSV' },
    { value: 'pdf', label: 'PDF (Pro)' },
    { value: 'json', label: 'JSON' },
  ];

  const defaultViewOptions = [
    { value: 'dashboard', label: 'Dashboard' },
    { value: 'market-watch', label: 'Market Watch' },
    { value: 'wallet-watch', label: 'Wallet Watch' },
  ];

  const disclosureLevelOptions = [
    { value: '1', label: 'Level 1 - Casual (5 metrics)' },
    { value: '2', label: 'Level 2 - Regular (10 metrics)' },
    { value: '3', label: 'Level 3 - Power User (20+ metrics)' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Insider Detection Alerts</h2>
        <p className="text-muted-foreground">
          Configure alerts for suspicious trading patterns and potential insider activity
        </p>
      </div>

      {/* Alert Disclaimer */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-4 rounded-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-200">Important Disclaimer</p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              Algorithmic flags are for informational purposes only and do not constitute legal accusations. All
              flagged activity should be independently verified before any action is taken.
            </p>
          </div>
        </div>
      </div>

      {/* Alert Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5" />
            <span>Alert Thresholds</span>
          </CardTitle>
          <CardDescription>Set thresholds for insider activity detection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="alert-thresholds-enabled"
            label="Enable Insider Alerts"
            description="Receive alerts for wallets flagged for suspicious activity"
            checked={insiderDetection.alertThresholds.enabled}
            onCheckedChange={(checked) => handleAlertThresholdsChange('enabled', checked)}
          />

          {insiderDetection.alertThresholds.enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="min-insider-score">Minimum Insider Score</Label>
                <Input
                  id="min-insider-score"
                  type="number"
                  value={insiderDetection.alertThresholds.minInsiderScore}
                  onChange={(e) => handleAlertThresholdsChange('minInsiderScore', Number(e.target.value))}
                  placeholder="6.0"
                  min="0"
                  max="10"
                  step="0.5"
                />
                <p className="text-xs text-muted-foreground">
                  Alert when wallet insider score exceeds this threshold (0-10 scale)
                </p>
              </div>

              <div className="space-y-2">
                <Label>Risk Levels to Monitor</Label>
                <div className="flex flex-wrap gap-2">
                  {riskLevels.map((level) => (
                    <Badge
                      key={level}
                      variant={insiderDetection.alertThresholds.riskLevels.includes(level) ? 'default' : 'outline'}
                      className="cursor-pointer capitalize"
                      onClick={() => {
                        const levels = insiderDetection.alertThresholds.riskLevels.includes(level)
                          ? insiderDetection.alertThresholds.riskLevels.filter((l) => l !== level)
                          : [...insiderDetection.alertThresholds.riskLevels, level];
                        handleAlertThresholdsChange('riskLevels', levels);
                      }}
                    >
                      {level}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Select which risk levels trigger alerts</p>
              </div>

              <SettingsToggle
                id="alert-on-status-change"
                label="Alert on Status Change"
                description="Notify when investigation status changes (flagged, under review, confirmed)"
                checked={insiderDetection.alertThresholds.alertOnStatusChange}
                onCheckedChange={(checked) => handleAlertThresholdsChange('alertOnStatusChange', checked)}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Market Watch */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Eye className="h-5 w-5" />
            <span>Market Watch</span>
          </CardTitle>
          <CardDescription>Monitor markets with suspicious activity patterns</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="market-watch-enabled"
            label="Enable Market Watch Alerts"
            description="Receive alerts for markets showing elevated insider activity"
            checked={insiderDetection.marketWatch.enabled}
            onCheckedChange={(checked) => handleMarketWatchChange('enabled', checked)}
          />

          {insiderDetection.marketWatch.enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="min-activity-score">Minimum Activity Score</Label>
                <Input
                  id="min-activity-score"
                  type="number"
                  value={insiderDetection.marketWatch.minActivityScore}
                  onChange={(e) => handleMarketWatchChange('minActivityScore', Number(e.target.value))}
                  placeholder="6.0"
                  min="0"
                  max="10"
                  step="0.5"
                />
                <p className="text-xs text-muted-foreground">Alert when market insider activity score exceeds this</p>
              </div>

              <div className="space-y-2">
                <Label>Priority Levels to Monitor</Label>
                <div className="flex flex-wrap gap-2">
                  {priorityLevels.map((level) => (
                    <Badge
                      key={level}
                      variant={insiderDetection.marketWatch.priorityLevels.includes(level) ? 'default' : 'outline'}
                      className="cursor-pointer capitalize"
                      onClick={() => {
                        const levels = insiderDetection.marketWatch.priorityLevels.includes(level)
                          ? insiderDetection.marketWatch.priorityLevels.filter((l) => l !== level)
                          : [...insiderDetection.marketWatch.priorityLevels, level];
                        handleMarketWatchChange('priorityLevels', levels);
                      }}
                    >
                      {level} Priority
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Watched Categories</Label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <Badge
                      key={category}
                      variant={
                        insiderDetection.marketWatch.watchedCategories.includes(category) ? 'default' : 'outline'
                      }
                      className="cursor-pointer"
                      onClick={() => {
                        const watchedCategories = insiderDetection.marketWatch.watchedCategories.includes(category)
                          ? insiderDetection.marketWatch.watchedCategories.filter((c) => c !== category)
                          : [...insiderDetection.marketWatch.watchedCategories, category];
                        handleMarketWatchChange('watchedCategories', watchedCategories);
                      }}
                    >
                      {category}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  Select categories to monitor. Leave empty to watch all categories.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Cluster Detection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Users className="h-5 w-5" />
            <span>Cluster Detection</span>
          </CardTitle>
          <CardDescription>Detect coordinated trading networks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="cluster-detection-enabled"
            label="Enable Cluster Detection Alerts"
            description="Receive alerts when coordinated wallet clusters are detected"
            checked={insiderDetection.clusterDetection.enabled}
            onCheckedChange={(checked) => handleClusterDetectionChange('enabled', checked)}
          />

          {insiderDetection.clusterDetection.enabled && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min-cluster-size">Minimum Cluster Size</Label>
                  <Input
                    id="min-cluster-size"
                    type="number"
                    value={insiderDetection.clusterDetection.minClusterSize}
                    onChange={(e) => handleClusterDetectionChange('minClusterSize', Number(e.target.value))}
                    placeholder="3"
                    min="2"
                    max="20"
                  />
                  <p className="text-xs text-muted-foreground">Minimum wallets required to form a cluster</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="min-cluster-score">Minimum Cluster Score</Label>
                  <Input
                    id="min-cluster-score"
                    type="number"
                    value={insiderDetection.clusterDetection.minClusterScore}
                    onChange={(e) => handleClusterDetectionChange('minClusterScore', Number(e.target.value))}
                    placeholder="6.0"
                    min="0"
                    max="10"
                    step="0.5"
                  />
                  <p className="text-xs text-muted-foreground">Alert when cluster average score exceeds this</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Connection Types to Monitor</Label>
                <div className="flex flex-wrap gap-2">
                  {connectionTypes.map((type) => (
                    <Badge
                      key={type}
                      variant={
                        insiderDetection.clusterDetection.connectionTypes.includes(type) ? 'default' : 'outline'
                      }
                      className="cursor-pointer capitalize"
                      onClick={() => {
                        const types = insiderDetection.clusterDetection.connectionTypes.includes(type)
                          ? insiderDetection.clusterDetection.connectionTypes.filter((t) => t !== type)
                          : [...insiderDetection.clusterDetection.connectionTypes, type];
                        handleClusterDetectionChange('connectionTypes', types);
                      }}
                    >
                      {type}
                    </Badge>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">Types of wallet connections to flag as clusters</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Timing Anomalies */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Clock className="h-5 w-5" />
            <span>Timing Anomalies</span>
          </CardTitle>
          <CardDescription>Detect suspiciously timed trades</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="timing-anomalies-enabled"
            label="Enable Timing Anomaly Alerts"
            description="Alert when wallets consistently trade right before outcomes"
            checked={insiderDetection.timingAnomalies.enabled}
            onCheckedChange={(checked) => handleTimingAnomaliesChange('enabled', checked)}
          />

          {insiderDetection.timingAnomalies.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max-time-to-outcome">Max Time to Outcome (minutes)</Label>
                <Input
                  id="max-time-to-outcome"
                  type="number"
                  value={insiderDetection.timingAnomalies.maxTimeToOutcome}
                  onChange={(e) => handleTimingAnomaliesChange('maxTimeToOutcome', Number(e.target.value))}
                  placeholder="60"
                  min="1"
                  max="1440"
                />
                <p className="text-xs text-muted-foreground">Flag trades this close to outcome (1h = suspicious)</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="min-timing-score">Minimum Timing Score</Label>
                <Input
                  id="min-timing-score"
                  type="number"
                  value={insiderDetection.timingAnomalies.minTimingScore}
                  onChange={(e) => handleTimingAnomaliesChange('minTimingScore', Number(e.target.value))}
                  placeholder="7.0"
                  min="0"
                  max="10"
                  step="0.5"
                />
                <p className="text-xs text-muted-foreground">Alert when timing score exceeds this threshold</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Volume Anomalies */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <BarChart className="h-5 w-5" />
            <span>Volume Anomalies</span>
          </CardTitle>
          <CardDescription>Detect unusual trade sizes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="volume-anomalies-enabled"
            label="Enable Volume Anomaly Alerts"
            description="Alert when trade sizes are statistically abnormal"
            checked={insiderDetection.volumeAnomalies.enabled}
            onCheckedChange={(checked) => handleVolumeAnomaliesChange('enabled', checked)}
          />

          {insiderDetection.volumeAnomalies.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="min-z-score">Minimum Z-Score</Label>
                <Input
                  id="min-z-score"
                  type="number"
                  value={insiderDetection.volumeAnomalies.minZScore}
                  onChange={(e) => handleVolumeAnomaliesChange('minZScore', Number(e.target.value))}
                  placeholder="3.0"
                  min="0"
                  max="10"
                  step="0.5"
                />
                <p className="text-xs text-muted-foreground">
                  Standard deviations from mean (3.0 = very unusual)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="min-volume-score">Minimum Volume Score</Label>
                <Input
                  id="min-volume-score"
                  type="number"
                  value={insiderDetection.volumeAnomalies.minVolumeScore}
                  onChange={(e) => handleVolumeAnomaliesChange('minVolumeScore', Number(e.target.value))}
                  placeholder="7.0"
                  min="0"
                  max="10"
                  step="0.5"
                />
                <p className="text-xs text-muted-foreground">Alert when volume score exceeds this threshold</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compliance Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="h-5 w-5" />
            <span>Compliance & Export</span>
          </CardTitle>
          <CardDescription>Configure automated compliance reporting</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsToggle
            id="auto-export-enabled"
            label="Enable Automated Exports"
            description="Automatically generate compliance reports on a schedule"
            checked={insiderDetection.complianceSettings.autoExportEnabled}
            onCheckedChange={(checked) => handleComplianceChange('autoExportEnabled', checked)}
          />

          {insiderDetection.complianceSettings.autoExportEnabled && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SettingsSelect
                  id="export-frequency"
                  label="Export Frequency"
                  description="How often to generate reports"
                  value={insiderDetection.complianceSettings.exportFrequency}
                  onValueChange={(value) => handleComplianceChange('exportFrequency', value)}
                  options={exportFrequencyOptions}
                />

                <SettingsSelect
                  id="export-format"
                  label="Export Format"
                  description="Report file format"
                  value={insiderDetection.complianceSettings.exportFormat}
                  onValueChange={(value) => handleComplianceChange('exportFormat', value)}
                  options={exportFormatOptions}
                />
              </div>

              <div className="space-y-3">
                <Label>Include in Reports</Label>
                <SettingsToggle
                  id="include-flags"
                  label="Flagged Wallets"
                  description="Include list of all flagged wallet addresses"
                  checked={insiderDetection.complianceSettings.includeFlags}
                  onCheckedChange={(checked) => handleComplianceChange('includeFlags', checked)}
                />

                <SettingsToggle
                  id="include-clusters"
                  label="Cluster Analysis"
                  description="Include detected wallet clusters and connections"
                  checked={insiderDetection.complianceSettings.includeClusters}
                  onCheckedChange={(checked) => handleComplianceChange('includeClusters', checked)}
                />

                <SettingsToggle
                  id="include-market-risk"
                  label="Market Risk Scores"
                  description="Include per-market insider activity scores"
                  checked={insiderDetection.complianceSettings.includeMarketRiskScores}
                  onCheckedChange={(checked) => handleComplianceChange('includeMarketRiskScores', checked)}
                />

                <SettingsToggle
                  id="include-investigation-notes"
                  label="Investigation Notes"
                  description="Include manual investigation notes and status updates"
                  checked={insiderDetection.complianceSettings.includeInvestigationNotes}
                  onCheckedChange={(checked) => handleComplianceChange('includeInvestigationNotes', checked)}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Display Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Display Preferences</span>
          </CardTitle>
          <CardDescription>Customize how insider detection data is displayed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingsSelect
            id="default-view"
            label="Default View"
            description="Which tab to show when opening Insiders page"
            value={insiderDetection.displayPreferences.defaultView}
            onValueChange={(value) => handleDisplayChange('defaultView', value)}
            options={defaultViewOptions}
          />

          <SettingsSelect
            id="disclosure-level"
            label="Progressive Disclosure Level"
            description="Amount of detail to show by default"
            value={String(insiderDetection.displayPreferences.progressiveDisclosureLevel)}
            onValueChange={(value) => handleDisplayChange('progressiveDisclosureLevel', Number(value))}
            options={disclosureLevelOptions}
          />

          <SettingsToggle
            id="show-advanced-metrics-insider"
            label="Show Advanced Metrics"
            description="Display detailed insider score breakdowns (requires Pro subscription)"
            checked={insiderDetection.displayPreferences.showAdvancedMetrics}
            onCheckedChange={(checked) => handleDisplayChange('showAdvancedMetrics', checked)}
          />
        </CardContent>
      </Card>
    </div>
  );
};
