"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Info, Plus, Settings, Shield, TrendingUp } from "lucide-react";
import { useState } from "react";
import { ArbitrageBot, Exchange } from "../../types";

import Image from "next/image";

interface CreateBotModalProps {
  isOpen: boolean;
  exchanges: Exchange[]; // Add this missing prop
  onClose: () => void;
  onCreateBot: (botData: Partial<ArbitrageBot>) => Promise<void>; // Update to match parent
}

interface BotData {
  name: string;
  description: string;
  strategy: string;
  exchanges: string[];
  tradingPairs: string[];
  initialCapital: number;
  minSpread: number;
  maxVolume: number;
  riskLevel: string;
  autoStart: boolean;
  notifications: boolean;
}

const defaultBotData: BotData = {
  name: "",
  description: "",
  strategy: "basic",
  exchanges: [],
  tradingPairs: [],
  initialCapital: 1000,
  minSpread: 0.5,
  maxVolume: 5000,
  riskLevel: "medium",
  autoStart: false,
  notifications: true,
};

const popularPairs = ["BTC/USDT", "ETH/USDT", "BNB/USDT", "ADA/USDT", "SOL/USDT", "DOT/USDT", "MATIC/USDT", "AVAX/USDT", "LINK/USDT", "UNI/USDT"];

export function CreateBotModal({ isOpen, exchanges, onClose, onCreateBot }: CreateBotModalProps) {
  const [botData, setBotData] = useState<BotData>(defaultBotData);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState("basic");

  const updateBotData = <K extends keyof BotData>(key: K, value: BotData[K]) => {
    setBotData((prev) => ({ ...prev, [key]: value }));
  };

  const toggleExchange = (exchangeId: string) => {
    setBotData((prev) => ({
      ...prev,
      exchanges: prev.exchanges.includes(exchangeId) ? prev.exchanges.filter((id) => id !== exchangeId) : [...prev.exchanges, exchangeId],
    }));
  };

  const toggleTradingPair = (pair: string) => {
    setBotData((prev) => ({
      ...prev,
      tradingPairs: prev.tradingPairs.includes(pair) ? prev.tradingPairs.filter((p) => p !== pair) : [...prev.tradingPairs, pair],
    }));
  };

  const handleCreate = async () => {
    if (!botData.name || botData.exchanges.length === 0 || botData.tradingPairs.length === 0) {
      return;
    }

    setIsLoading(true);
    try {
      await onCreateBot(botData);
      setBotData(defaultBotData);
      onClose();
    } catch (error) {
      console.error("Failed to create bot:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const isFormValid = botData.name && botData.exchanges.length > 0 && botData.tradingPairs.length > 0;

  const connectedExchanges = exchanges.filter((exchange) => exchange.status === "connected");

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create New Arbitrage Bot
          </DialogTitle>
          <DialogDescription>Configure your new arbitrage bot with custom settings and trading parameters</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[calc(90vh-200px)]">
          <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-4">
            <div className="overflow-x-auto">
              <TabsList className="w-full justify-between">
                <TabsTrigger value="basic" className="text-xs sm:text-sm">
                  <Settings className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className=" inline">Basic</span>
                </TabsTrigger>
                <TabsTrigger value="exchanges" className="text-xs sm:text-sm">
                  <TrendingUp className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className=" inline">Exchanges</span>
                </TabsTrigger>
                <TabsTrigger value="trading" className="text-xs sm:text-sm">
                  <TrendingUp className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className=" inline">Trading</span>
                </TabsTrigger>
                <TabsTrigger value="risk" className="text-xs sm:text-sm">
                  <Shield className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
                  <span className=" inline">Risk</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="basic" className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="botName">Bot Name *</Label>
                  <Input id="botName" placeholder="Enter bot name" value={botData.name} onChange={(e) => updateBotData("name", e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="strategy">Strategy</Label>
                  <Select value={botData.strategy} onValueChange={(value) => updateBotData("strategy", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic Arbitrage</SelectItem>
                      <SelectItem value="triangular">Triangular Arbitrage</SelectItem>
                      <SelectItem value="statistical">Statistical Arbitrage</SelectItem>
                      <SelectItem value="cross-exchange">Cross-Exchange</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" placeholder="Describe your bot's purpose and strategy" value={botData.description} onChange={(e) => updateBotData("description", e.target.value)} rows={3} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="initialCapital">Initial Capital ($)</Label>
                <Input id="initialCapital" type="number" value={botData.initialCapital} onChange={(e) => updateBotData("initialCapital", Number(e.target.value))} />
              </div>
            </TabsContent>

            <TabsContent value="exchanges" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label>Select Exchanges *</Label>
                  <p className="text-sm text-muted-foreground mb-3">Choose at least 2 exchanges for arbitrage opportunities</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {connectedExchanges.map((exchange) => (
                      <Card
                        key={exchange.id}
                        className={`cursor-pointer transition-colors ${botData.exchanges.includes(exchange.id) ? "border-primary bg-primary/5" : "hover:border-primary/50"} ${
                          exchange.status === "disconnected" ? "opacity-50" : ""
                        }`}
                        onClick={() => exchange.status === "connected" && toggleExchange(exchange.id)}
                      >
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="h-6 w-6 overflow-hidden rounded-full">
                                <Image src={exchange.logo || "/placeholder.svg"} alt={exchange.name} className="h-full w-full object-cover" width={24} height={24} />
                              </div>
                              <div className="font-medium text-sm">{exchange.name}</div>
                              <Badge variant={exchange.status === "connected" ? "default" : "secondary"} className="text-xs">
                                {exchange.status}
                              </Badge>
                            </div>
                            {botData.exchanges.includes(exchange.id) && <div className="h-2 w-2 rounded-full bg-primary" />}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>

                {botData.exchanges.length > 0 && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      Selected {botData.exchanges.length} exchange{botData.exchanges.length > 1 ? "s" : ""}. Make sure you have sufficient balance on each exchange.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>

            <TabsContent value="trading" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label>Trading Pairs *</Label>
                  <p className="text-sm text-muted-foreground mb-3">Select trading pairs to monitor for arbitrage</p>
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
                    {popularPairs.map((pair) => (
                      <Button key={pair} variant={botData.tradingPairs.includes(pair) ? "default" : "outline"} size="sm" onClick={() => toggleTradingPair(pair)} className="text-xs">
                        {pair}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Minimum Spread (%)</Label>
                    <div className="space-y-2">
                      <Slider value={[botData.minSpread]} onValueChange={([value]) => updateBotData("minSpread", value)} max={5} min={0.1} step={0.1} className="w-full" />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>0.1%</span>
                        <Badge variant="outline">{botData.minSpread}%</Badge>
                        <span>5%</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxVolume">Max Volume per Trade ($)</Label>
                    <Input id="maxVolume" type="number" value={botData.maxVolume} onChange={(e) => updateBotData("maxVolume", Number(e.target.value))} />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="risk" className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Risk Level</Label>
                  <Select value={botData.riskLevel} onValueChange={(value) => updateBotData("riskLevel", value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low Risk - Conservative</SelectItem>
                      <SelectItem value="medium">Medium Risk - Balanced</SelectItem>
                      <SelectItem value="high">High Risk - Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto Start</Label>
                      <p className="text-xs text-muted-foreground">Start trading immediately after creation</p>
                    </div>
                    <Switch checked={botData.autoStart} onCheckedChange={(checked) => updateBotData("autoStart", checked)} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable Notifications</Label>
                      <p className="text-xs text-muted-foreground">Receive alerts for trades and errors</p>
                    </div>
                    <Switch checked={botData.notifications} onCheckedChange={(checked) => updateBotData("notifications", checked)} />
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex flex-col sm:flex-row justify-between gap-2 pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {botData.exchanges.length > 0 && botData.tradingPairs.length > 0 && (
              <span>
                {botData.exchanges.length} exchange{botData.exchanges.length > 1 ? "s" : ""}, {botData.tradingPairs.length} pair{botData.tradingPairs.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isLoading || !isFormValid}>
              <Plus className="mr-2 h-4 w-4" />
              {isLoading ? "Creating..." : "Create Bot"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
