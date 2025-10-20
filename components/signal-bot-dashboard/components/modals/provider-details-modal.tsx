"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Activity, Calendar, DollarSign, Star, TrendingUp, Users } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { Signal, SignalProvider } from "../../types";
import { formatDate } from "../../utils";

interface ProviderDetailsModalProps {
  isOpen: boolean;
  provider: SignalProvider | null;
  recentSignals: Signal[];
  dailyPerformanceData: any[];
  onClose: () => void;
}

export function ProviderDetailsModal({ isOpen, provider, recentSignals, dailyPerformanceData, onClose }: ProviderDetailsModalProps) {
  if (!provider) return null;

  const providerSignals = recentSignals.filter((signal) => signal.provider === provider.name).slice(0, 3);

  const handleSubscribe = () => {
    // TODO: Implement subscription logic
    console.log("Subscribing to provider:", provider.name);
    onClose();
  };

  const handleFollow = () => {
    // TODO: Implement follow logic
    console.log("Following provider:", provider.name);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Provider Details</DialogTitle>
          <DialogDescription>Detailed information about the signal provider</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Provider Header */}
          <div className="flex items-start gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={provider.avatar || "/placeholder.svg"} alt={provider.name} />
              <AvatarFallback>{provider.name.substring(0, 2)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xl font-semibold">{provider.name}</h3>
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <span className="text-sm font-medium">4.8</span>
                </div>
              </div>
              <p className="text-muted-foreground mb-3">{provider.description}</p>
              <div className="flex items-center gap-2">
                <Badge variant={provider.status === "active" ? "default" : "secondary"}>{provider.status}</Badge>
                <Badge variant="outline" className="gap-1">
                  <DollarSign className="h-3 w-3" />
                  {provider.price}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Users className="h-3 w-3" />
                  {provider.subscribers.toLocaleString()} subscribers
                </Badge>
              </div>
            </div>
          </div>

          {/* Key Metrics */}
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  <span className="text-2xl font-bold">{provider.accuracy}%</span>
                </div>
                <p className="text-sm text-muted-foreground">Accuracy Rate</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Activity className="h-4 w-4 text-blue-600" />
                  <span className="text-2xl font-bold">{provider.signals}</span>
                </div>
                <p className="text-sm text-muted-foreground">Total Signals</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-purple-600" />
                  <span className="text-2xl font-bold">{provider.subscribers.toLocaleString()}</span>
                </div>
                <p className="text-sm text-muted-foreground">Subscribers</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Star className="h-4 w-4 text-yellow-600" />
                  <span className="text-2xl font-bold">4.8</span>
                </div>
                <p className="text-sm text-muted-foreground">Rating</p>
              </CardContent>
            </Card>
          </div>

          {/* Performance Chart */}
          <Card>
            <CardContent className="p-6">
              <h4 className="font-medium mb-4">Recent Performance</h4>
              <div className="h-[200px] w-full">
                <ChartContainer
                  config={{
                    performance: {
                      label: "Performance",
                      color: "hsl(var(--chart-1))",
                    },
                  }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyPerformanceData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="performance" stroke="var(--color-performance)" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            </CardContent>
          </Card>

          {/* Recent Signals */}
          <Card>
            <CardContent className="p-6">
              <h4 className="font-medium mb-4">Recent Signals</h4>
              <div className="space-y-3">
                {providerSignals.length > 0 ? (
                  providerSignals.map((signal) => (
                    <div key={signal.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{signal.asset}</span>
                            <Badge variant={signal.type === "SHORT" ? "default" : "destructive"}>{signal.type.toUpperCase()}</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{signal.confidence}% confidence</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(signal.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">${signal.entryPrice.toLocaleString()}</p>
                        <p className="text-sm text-muted-foreground">Entry Price</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No recent signals available</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Additional Stats */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <h5 className="font-medium mb-3">Performance Metrics</h5>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Win Rate</span>
                    <span className="text-sm font-medium">{provider.accuracy}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Avg. Return</span>
                    <span className="text-sm font-medium text-green-600">+12.5%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Max Drawdown</span>
                    <span className="text-sm font-medium text-red-600">-8.2%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Sharpe Ratio</span>
                    <span className="text-sm font-medium">1.85</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <h5 className="font-medium mb-3">Provider Info</h5>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Active Since</span>
                    <span className="text-sm font-medium">Jan 2023</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Signal Frequency</span>
                    <span className="text-sm font-medium">5-8 per day</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Markets</span>
                    <span className="text-sm font-medium">Crypto, Forex</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Risk Level</span>
                    <Badge variant="outline">Medium</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter className="flex justify-between gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleSubscribe}>
              Subscribe
            </Button>
            <Button onClick={handleFollow}>Follow Provider</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
