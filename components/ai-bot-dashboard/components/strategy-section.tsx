"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, BarChart3, CheckCircle, Clock, Copy, Edit, Plus, Settings, Shield, Trash2, TrendingUp, XCircle, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useStrategies, type NewStrategyData } from "../hooks/use-strategies";
import type { BotData, RiskSettings, Strategy } from "../types";
import { formatCurrency, formatPercentage } from "../utils";

interface StrategySectionProps {
  botData: BotData;
  onStrategyChange: (strategyId: string) => void;
  onRiskSettingsChange: (settings: RiskSettings) => void;
}

const TIMEFRAME_OPTIONS = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "30m", label: "30 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "1d", label: "1 Day" },
  { value: "1w", label: "1 Week" },
];

const INDICATOR_OPTIONS = ["RSI", "MACD", "Bollinger Bands", "Moving Average", "Stochastic", "Williams %R", "CCI", "ADX", "Parabolic SAR", "Ichimoku Cloud"];

export function StrategySection({ botData, onStrategyChange, onRiskSettingsChange }: StrategySectionProps) {
  const { strategies, addStrategy, editStrategy, deleteStrategy, cloneStrategy, toggleStrategyStatus } = useStrategies(botData.strategies);

  const [selectedStrategy, setSelectedStrategy] = useState(botData.strategies[0]?.id || "");
  const [riskSettings, setRiskSettings] = useState(botData.riskSettings);
  const [showCreateStrategy, setShowCreateStrategy] = useState(false);
  const [showEditStrategy, setShowEditStrategy] = useState(false);
  const [editingStrategy, setEditingStrategy] = useState<Strategy | null>(null);
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([]);

  const [newStrategy, setNewStrategy] = useState<NewStrategyData>({
    name: "",
    description: "",
    risk: "medium",
    timeframe: "1h",
    conditions: "",
    entryRules: [],
    exitRules: [],
    indicators: [],
  });

  // Reset form when modal closes
  const resetNewStrategyForm = () => {
    setNewStrategy({
      name: "",
      description: "",
      risk: "medium",
      timeframe: "1h",
      conditions: "",
      entryRules: [],
      exitRules: [],
      indicators: [],
    });
  };

  // Handle strategy toggle
  const handleStrategyToggle = async (strategyId: string, active: boolean) => {
    try {
      toggleStrategyStatus(strategyId, active);
      toast.success(`Strategy ${active ? "activated" : "deactivated"} successfully`);

      if (active) {
        onStrategyChange(strategyId);
      }
    } catch (error) {
      toast.error("Failed to update strategy status");
      console.error("Error toggling strategy:", error);
    }
  };

  // Handle risk setting changes
  const handleRiskSettingChange = (key: keyof RiskSettings, value: number) => {
    const updatedSettings = { ...riskSettings, [key]: value };
    setRiskSettings(updatedSettings);
    onRiskSettingsChange(updatedSettings);
  };

  // Handle create strategy
  const handleCreateStrategy = async () => {
    try {
      // Validation
      if (!newStrategy.name.trim()) {
        toast.error("Strategy name is required");
        return;
      }

      if (!newStrategy.description.trim()) {
        toast.error("Strategy description is required");
        return;
      }

      const createdStrategy = addStrategy(newStrategy);
      toast.success(`Strategy "${createdStrategy.name}" created successfully`);

      setShowCreateStrategy(false);
      resetNewStrategyForm();
    } catch (error) {
      toast.error("Failed to create strategy");
      console.error("Error creating strategy:", error);
    }
  };

  // Handle edit strategy
  const handleEditStrategy = (strategy: Strategy) => {
    setEditingStrategy(strategy);
    setNewStrategy({
      name: strategy.name,
      description: strategy.description,
      risk: strategy.risk,
      timeframe: strategy.timeframe,
      conditions: "",
      entryRules: [],
      exitRules: [],
      indicators: [],
    });
    setShowEditStrategy(true);
  };

  // Handle save edited strategy
  const handleSaveEditedStrategy = async () => {
    if (!editingStrategy) return;

    try {
      // Validation
      if (!newStrategy.name.trim()) {
        toast.error("Strategy name is required");
        return;
      }

      editStrategy(editingStrategy.id, {
        name: newStrategy.name,
        description: newStrategy.description,
        risk: newStrategy.risk,
        timeframe: newStrategy.timeframe,
      });

      toast.success(`Strategy "${newStrategy.name}" updated successfully`);
      setShowEditStrategy(false);
      setEditingStrategy(null);
      resetNewStrategyForm();
    } catch (error) {
      toast.error("Failed to update strategy");
      console.error("Error updating strategy:", error);
    }
  };

  // Handle delete strategy
  const handleDeleteStrategy = async (strategyId: string) => {
    try {
      const strategy = strategies.find((s) => s.id === strategyId);
      if (!strategy) return;

      deleteStrategy(strategyId);
      toast.success(`Strategy "${strategy.name}" deleted successfully`);

      // If deleted strategy was selected, select another one
      if (selectedStrategy === strategyId) {
        const remainingStrategies = strategies.filter((s) => s.id !== strategyId);
        if (remainingStrategies.length > 0) {
          setSelectedStrategy(remainingStrategies[0].id);
          onStrategyChange(remainingStrategies[0].id);
        }
      }
    } catch (error) {
      toast.error("Failed to delete strategy");
      console.error("Error deleting strategy:", error);
    }
  };

  // Handle clone strategy
  const handleCloneStrategy = async (strategy: Strategy) => {
    try {
      const clonedStrategy = cloneStrategy(strategy.id);
      if (clonedStrategy) {
        toast.success(`Strategy "${clonedStrategy.name}" cloned successfully`);
      }
    } catch (error) {
      toast.error("Failed to clone strategy");
      console.error("Error cloning strategy:", error);
    }
  };

  // Handle bulk selection
  const handleSelectStrategy = (strategyId: string, checked: boolean) => {
    if (checked) {
      setSelectedStrategies((prev) => [...prev, strategyId]);
    } else {
      setSelectedStrategies((prev) => prev.filter((id) => id !== strategyId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedStrategies(strategies.map((s) => s.id));
    } else {
      setSelectedStrategies([]);
    }
  };

  // Handle bulk operations
  const handleBulkDelete = async () => {
    try {
      const strategyNames = strategies.filter((s) => selectedStrategies.includes(s.id)).map((s) => s.name);

      selectedStrategies.forEach((id) => deleteStrategy(id));

      toast.success(`Deleted ${selectedStrategies.length} strategies: ${strategyNames.join(", ")}`);
      setSelectedStrategies([]);
    } catch (error) {
      toast.error("Failed to delete strategies");
      console.error("Error deleting strategies:", error);
    }
  };

  const handleBulkActivate = async () => {
    try {
      selectedStrategies.forEach((id) => toggleStrategyStatus(id, true));
      toast.success(`Activated ${selectedStrategies.length} strategies`);
      setSelectedStrategies([]);
    } catch (error) {
      toast.error("Failed to activate strategies");
      console.error("Error activating strategies:", error);
    }
  };

  const handleBulkDeactivate = async () => {
    try {
      selectedStrategies.forEach((id) => toggleStrategyStatus(id, false));
      toast.success(`Deactivated ${selectedStrategies.length} strategies`);
      setSelectedStrategies([]);
    } catch (error) {
      toast.error("Failed to deactivate strategies");
      console.error("Error deactivating strategies:", error);
    }
  };

  // Utility functions
  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "low":
        return "text-green-600 bg-green-100";
      case "medium":
        return "text-yellow-600 bg-yellow-100";
      case "high":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  const getStrategyStatus = (strategy: Strategy) => {
    if (strategy.active) {
      return (
        <Badge className="bg-green-100 text-green-700">
          <CheckCircle className="w-3 h-3 mr-1" />
          Active
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <XCircle className="w-3 h-3 mr-1" />
        Inactive
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Strategy Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Strategies</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{strategies.filter((s) => s.active).length}</div>
            <p className="text-xs text-muted-foreground">of {strategies.length} total</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Risk Level</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{strategies.find((s) => s.id === selectedStrategy)?.risk || "Medium"}</div>
            <p className="text-xs text-muted-foreground">Current strategy risk</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Performance</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatPercentage(botData.profit.total)}</div>
            <p className="text-xs text-muted-foreground">Total return</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="strategies" className="space-y-4">
        <TabsList>
          <TabsTrigger value="strategies">Strategies</TabsTrigger>
          <TabsTrigger value="risk">Risk Management</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* Strategies Tab */}
        <TabsContent value="strategies" className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <h3 className="text-lg font-semibold">Trading Strategies</h3>
              {selectedStrategies.length > 0 && (
                <div className="flex items-center space-x-2">
                  <Badge variant="outline">{selectedStrategies.length} selected</Badge>
                  <Button variant="outline" size="sm" onClick={handleBulkActivate}>
                    <Zap className="w-4 h-4 mr-1" />
                    Activate
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleBulkDeactivate}>
                    <XCircle className="w-4 h-4 mr-1" />
                    Deactivate
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Selected Strategies</AlertDialogTitle>
                        <AlertDialogDescription>Are you sure you want to delete {selectedStrategies.length} selected strategies? This action cannot be undone.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleBulkDelete}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
            <Dialog open={showCreateStrategy} onOpenChange={setShowCreateStrategy}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Strategy
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Strategy</DialogTitle>
                  <DialogDescription>Define a new trading strategy with custom parameters.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Strategy Name *</Label>
                    <Input id="name" value={newStrategy.name} onChange={(e) => setNewStrategy({ ...newStrategy, name: e.target.value })} placeholder="Enter strategy name" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="description">Description *</Label>
                    <Textarea
                      id="description"
                      value={newStrategy.description}
                      onChange={(e) => setNewStrategy({ ...newStrategy, description: e.target.value })}
                      placeholder="Describe your strategy"
                      rows={3}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="risk">Risk Level</Label>
                      <Select value={newStrategy.risk} onValueChange={(value: any) => setNewStrategy({ ...newStrategy, risk: value })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low Risk</SelectItem>
                          <SelectItem value="medium">Medium Risk</SelectItem>
                          <SelectItem value="high">High Risk</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="timeframe">Timeframe</Label>
                      <Select value={newStrategy.timeframe} onValueChange={(value) => setNewStrategy({ ...newStrategy, timeframe: value })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEFRAME_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="conditions">Trading Conditions</Label>
                    <Textarea
                      id="conditions"
                      value={newStrategy.conditions}
                      onChange={(e) => setNewStrategy({ ...newStrategy, conditions: e.target.value })}
                      placeholder="Define when this strategy should execute trades"
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateStrategy(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateStrategy}>Create Strategy</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Bulk selection */}
          {strategies.length > 0 && (
            <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg">
              <Checkbox checked={selectedStrategies.length === strategies.length} onCheckedChange={handleSelectAll} />
              <Label className="text-sm">Select all strategies</Label>
            </div>
          )}

          <div className="grid gap-4">
            {strategies.map((strategy) => (
              <Card key={strategy.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Checkbox checked={selectedStrategies.includes(strategy.id)} onCheckedChange={(checked) => handleSelectStrategy(strategy.id, checked as boolean)} />
                      <div className="space-y-1">
                        <CardTitle className="text-base">{strategy.name}</CardTitle>
                        <CardDescription>{strategy.description}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getStrategyStatus(strategy)}
                      <Badge className={getRiskColor(strategy.risk)}>{strategy.risk}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center space-x-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{TIMEFRAME_OPTIONS.find((t) => t.value === strategy.timeframe)?.label || strategy.timeframe}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Switch checked={strategy.active} onCheckedChange={(checked) => handleStrategyToggle(strategy.id, checked)} />
                        <span className="text-sm">Active</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button variant="outline" size="sm" onClick={() => handleCloneStrategy(strategy)} title="Clone strategy">
                        <Copy className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleEditStrategy(strategy)} title="Edit strategy">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" title="Delete strategy">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Strategy</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to delete &quot;{strategy.name}&quot;? This action cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteStrategy(strategy.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {strategies.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Settings className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Strategies Found</h3>
                  <p className="text-muted-foreground text-center mb-4">Create your first trading strategy to get started with automated trading.</p>
                  <Button onClick={() => setShowCreateStrategy(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Strategy
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Risk Management Tab */}
        <TabsContent value="risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Risk Management Settings</CardTitle>
              <CardDescription>Configure risk parameters to protect your capital</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Max Drawdown: {formatPercentage(riskSettings.maxDrawdown)}</Label>
                  <Slider value={[riskSettings.maxDrawdown]} onValueChange={([value]) => handleRiskSettingChange("maxDrawdown", value)} max={50} min={5} step={1} className="w-full" />
                  <p className="text-xs text-muted-foreground">Maximum portfolio loss before stopping</p>
                </div>

                <div className="space-y-2">
                  <Label>Stop Loss: {formatPercentage(riskSettings.stopLoss)}</Label>
                  <Slider value={[riskSettings.stopLoss]} onValueChange={([value]) => handleRiskSettingChange("stopLoss", value)} max={20} min={1} step={0.5} className="w-full" />
                  <p className="text-xs text-muted-foreground">Stop loss percentage per trade</p>
                </div>

                <div className="space-y-2">
                  <Label>Take Profit: {formatPercentage(riskSettings.takeProfit)}</Label>
                  <Slider value={[riskSettings.takeProfit]} onValueChange={([value]) => handleRiskSettingChange("takeProfit", value)} max={50} min={5} step={1} className="w-full" />
                  <p className="text-xs text-muted-foreground">Take profit percentage per trade</p>
                </div>

                <div className="space-y-2">
                  <Label>Max Position Size: {formatPercentage(riskSettings.maxPositionSize)}</Label>
                  <Slider value={[riskSettings.maxPositionSize]} onValueChange={([value]) => handleRiskSettingChange("maxPositionSize", value)} max={100} min={1} step={1} className="w-full" />
                  <p className="text-xs text-muted-foreground">Maximum position size per trade</p>
                </div>

                <div className="space-y-2">
                  <Label>Daily Loss Limit: {formatCurrency(riskSettings.dailyLossLimit)}</Label>
                  <Slider value={[riskSettings.dailyLossLimit]} onValueChange={([value]) => handleRiskSettingChange("dailyLossLimit", value)} max={10000} min={100} step={100} className="w-full" />
                  <p className="text-xs text-muted-foreground">Maximum daily loss in USD</p>
                </div>

                <div className="space-y-2">
                  <Label>Leverage Limit: {riskSettings.leverageLimit}x</Label>
                  <Slider value={[riskSettings.leverageLimit]} onValueChange={([value]) => handleRiskSettingChange("leverageLimit", value)} max={20} min={1} step={1} className="w-full" />
                  <p className="text-xs text-muted-foreground">Maximum leverage multiplier</p>
                </div>
              </div>

              <Separator />

              <div className="flex items-center space-x-2 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">Risk Warning</p>
                  <p className="text-xs text-yellow-700">These settings directly affect your trading risk. Lower values are safer but may limit profits.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Strategy Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {strategies.map((strategy) => (
                    <div key={strategy.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{strategy.name}</p>
                        <p className="text-sm text-muted-foreground">{strategy.timeframe}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium text-green-600">+12.5%</p>
                        <p className="text-xs text-muted-foreground">Last 30 days</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Risk Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <span className="text-sm">Sharpe Ratio</span>
                    <span className="font-medium">1.85</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Max Drawdown</span>
                    <span className="font-medium text-red-600">-8.2%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Win Rate</span>
                    <span className="font-medium">{formatPercentage(botData.trades.winRate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Profit Factor</span>
                    <span className="font-medium">2.1</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Average Trade</span>
                    <span className="font-medium text-green-600">+$45.20</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Edit Strategy Modal */}
      <Dialog open={showEditStrategy} onOpenChange={setShowEditStrategy}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Strategy</DialogTitle>
            <DialogDescription>Modify the strategy parameters.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Strategy Name *</Label>
              <Input id="edit-name" value={newStrategy.name} onChange={(e) => setNewStrategy({ ...newStrategy, name: e.target.value })} placeholder="Enter strategy name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description *</Label>
              <Textarea
                id="edit-description"
                value={newStrategy.description}
                onChange={(e) => setNewStrategy({ ...newStrategy, description: e.target.value })}
                placeholder="Describe your strategy"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-risk">Risk Level</Label>
                <Select value={newStrategy.risk} onValueChange={(value: any) => setNewStrategy({ ...newStrategy, risk: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low Risk</SelectItem>
                    <SelectItem value="medium">Medium Risk</SelectItem>
                    <SelectItem value="high">High Risk</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-timeframe">Timeframe</Label>
                <Select value={newStrategy.timeframe} onValueChange={(value) => setNewStrategy({ ...newStrategy, timeframe: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEFRAME_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditStrategy(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEditedStrategy}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
