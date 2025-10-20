"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, AlertTriangle, ArrowRight, BarChart3, Clock, DollarSign, TrendingUp, Zap } from "lucide-react";
import type { ArbitrageOpportunity } from "../../types";

interface OpportunityDetailsModalProps {
  opportunity: ArbitrageOpportunity | null;
  isOpen: boolean;
  onClose: () => void;
  onExecute: (opportunityId: string) => void;
}

export function OpportunityDetailsModal({ opportunity, isOpen, onClose, onExecute }: OpportunityDetailsModalProps) {
  if (!opportunity) return null;

  const riskLevel = opportunity.spread > 3 ? "High" : opportunity.spread > 1.5 ? "Medium" : "Low";
  const riskColor = riskLevel === "High" ? "destructive" : riskLevel === "Medium" ? "default" : "secondary";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span>Arbitrage Opportunity</span>
              <Badge variant={opportunity.status === "active" ? "default" : "secondary"}>{opportunity.status}</Badge>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center">
                  <DollarSign className="h-4 w-4 mr-1" />
                  Profit
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">${opportunity.profit.toFixed(2)}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center">
                  <TrendingUp className="h-4 w-4 mr-1" />
                  Spread
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{opportunity.spread.toFixed(2)}%</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center">
                  <BarChart3 className="h-4 w-4 mr-1" />
                  Volume
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${opportunity.volume.toLocaleString()}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center">
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  Risk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={riskColor} className="text-sm">
                  {riskLevel}
                </Badge>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="details" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
              <TabsTrigger value="execution">Execution</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Trading Pair Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-center space-x-4">
                    <div className="text-center">
                      <div className="font-semibold text-lg">{opportunity.buyExchange}</div>
                      <div className="text-sm text-muted-foreground">Buy Exchange</div>
                      <div className="text-green-600 font-medium">${(opportunity.volume / (1 + opportunity.spread / 100)).toFixed(2)}</div>
                    </div>
                    <ArrowRight className="h-8 w-8 text-muted-foreground" />
                    <div className="text-center">
                      <div className="font-semibold text-lg">{opportunity.sellExchange}</div>
                      <div className="text-sm text-muted-foreground">Sell Exchange</div>
                      <div className="text-red-600 font-medium">${opportunity.volume.toFixed(2)}</div>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Trading Pair</div>
                      <div className="font-medium">{opportunity.pair}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Timestamp</div>
                      <div className="font-medium">{opportunity.timestamp.toLocaleString()}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analysis" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Risk Analysis</CardTitle>
                  <CardDescription>Detailed risk assessment for this opportunity</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Liquidity Risk</span>
                      <span className="font-medium">Low</span>
                    </div>
                    <Progress value={25} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Price Impact</span>
                      <span className="font-medium">Medium</span>
                    </div>
                    <Progress value={60} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Execution Speed Required</span>
                      <span className="font-medium">High</span>
                    </div>
                    <Progress value={85} className="h-2" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Market Conditions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground">Market Volatility</div>
                      <div className="font-medium">Moderate</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Network Congestion</div>
                      <div className="font-medium">Low</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Gas Fees</div>
                      <div className="font-medium">$12.50</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Estimated Duration</div>
                      <div className="font-medium">2-5 minutes</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="execution" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Execution Plan</CardTitle>
                  <CardDescription>Step-by-step execution strategy</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">1</div>
                      <div>
                        <div className="font-medium">Buy on {opportunity.buyExchange}</div>
                        <div className="text-sm text-muted-foreground">Purchase {opportunity.pair} at lower price</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">2</div>
                      <div>
                        <div className="font-medium">Transfer Assets</div>
                        <div className="text-sm text-muted-foreground">Move assets to {opportunity.sellExchange}</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      <div className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">3</div>
                      <div>
                        <div className="font-medium">Sell on {opportunity.sellExchange}</div>
                        <div className="text-sm text-muted-foreground">Sell {opportunity.pair} at higher price</div>
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="bg-muted p-4 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <Activity className="h-4 w-4" />
                      <span className="font-medium">Execution Summary</span>
                    </div>
                    <div className="text-sm space-y-1">
                      <div>
                        Expected Profit: <span className="font-medium text-green-600">${opportunity.profit.toFixed(2)}</span>
                      </div>
                      <div>
                        Estimated Time: <span className="font-medium">2-5 minutes</span>
                      </div>
                      <div>
                        Success Probability: <span className="font-medium">87%</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          {opportunity.status === "active" && (
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
              <Button
                className="flex-1"
                onClick={() => {
                  onExecute(opportunity.id);
                  onClose();
                }}
              >
                <Zap className="mr-2 h-4 w-4" />
                Execute Arbitrage
              </Button>
              <Button variant="outline" className="flex-1">
                <Clock className="mr-2 h-4 w-4" />
                Schedule Execution
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
