"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, LineChart, Plus, TrendingUp, Zap } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { mockChartData } from "../data";
import type { ChartData } from "../types";

interface PriceChartProps {
  pair: string;
}

export function PriceChart({ pair }: PriceChartProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState("15m");
  const [showIndicators, setShowIndicators] = useState(false);
  const [showDrawing, setShowDrawing] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<string[]>([]);
  const [drawingMode, setDrawingMode] = useState<string | null>(null);

  const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];

  // Function to simulate fetching chart data based on timeframe
  const getChartDataForTimeframe = (timeframe: string): ChartData[] => {
    // In a real application, you would fetch data from an API here
    // For demonstration, we'll return different slices of mock data
    switch (timeframe) {
      case "1m":
        return mockChartData.slice(0, 5);
      case "5m":
        return mockChartData.slice(0, 8);
      case "15m":
        return mockChartData;
      case "1h":
        return mockChartData.filter((_, i) => i % 2 === 0);
      case "4h":
        return mockChartData.filter((_, i) => i % 3 === 0);
      case "1d":
        return mockChartData.filter((_, i) => i % 4 === 0);
      case "1w":
        return mockChartData.filter((_, i) => i % 5 === 0);
      default:
        return mockChartData;
    }
  };

  const currentChartData = getChartDataForTimeframe(selectedTimeframe);

  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between pb-2">
        <div>
          <CardTitle className="text-xl font-bold">{pair.toUpperCase()} Chart</CardTitle>
          <div className="flex items-center flex-wrap gap-2">
            {timeframes.map((timeframe) => (
              <Button key={timeframe} variant={selectedTimeframe === timeframe ? "secondary" : "ghost"} size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedTimeframe(timeframe)}>
                {timeframe}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className={cn("relative overflow-hidden rounded-b-lg bg-background")}>
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={currentChartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="time" className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} />
              <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 12 }} tickFormatter={(value) => `$${value.toLocaleString()}`} domain={["dataMin - 50", "dataMax + 50"]} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="rounded-lg border bg-background p-3 shadow-md">
                        <p className="font-medium">{label}</p>
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-muted-foreground">Price:</span>
                            <span className="font-medium text-green-500">${payload[0]?.value?.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-sm text-muted-foreground">Volume:</span>
                            <span className="font-medium">{payload[0]?.payload?.volume}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                fill="url(#priceGradient)"
                dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5, stroke: "hsl(var(--primary))", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Chart Info Overlay */}
          <div className="absolute bottom-4 left-4 rounded-md bg-background/90 p-2 text-sm backdrop-blur">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="text-muted-foreground">Open:</div>
              <div className="font-medium">$42,899.04</div>
              <div className="text-muted-foreground">High:</div>
              <div className="font-medium">$43,050.65</div>
              <div className="text-muted-foreground">Low:</div>
              <div className="font-medium">$42,850.18</div>
              <div className="text-muted-foreground">Close:</div>
              <div className="font-medium">$42,995.07</div>
              <div className="text-muted-foreground">Volume:</div>
              <div className="font-medium">$717.71M</div>
            </div>
          </div>

          {/* Chart Controls */}
          <div className="absolute bottom-4 right-4 flex gap-1">
            <Dialog open={showIndicators} onOpenChange={setShowIndicators}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 bg-background/90 backdrop-blur">
                  <LineChart className="mr-1 h-3.5 w-3.5" />
                  Indicators
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Technical Indicators</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">Moving Averages</h4>
                    <div className="space-y-2">
                      {[
                        { id: "sma20", label: "SMA (20)", color: "text-blue-500" },
                        { id: "sma50", label: "SMA (50)", color: "text-green-500" },
                        { id: "ema12", label: "EMA (12)", color: "text-purple-500" },
                        { id: "ema26", label: "EMA (26)", color: "text-orange-500" },
                      ].map((indicator) => (
                        <div key={indicator.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={indicator.id}
                            checked={activeIndicators.includes(indicator.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setActiveIndicators([...activeIndicators, indicator.id]);
                              } else {
                                setActiveIndicators(activeIndicators.filter((id) => id !== indicator.id));
                              }
                            }}
                          />
                          <Label htmlFor={indicator.id} className="flex items-center gap-2">
                            <div className={`w-3 h-0.5 ${indicator.color} bg-current`} />
                            {indicator.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <h4 className="text-sm font-medium">Oscillators</h4>
                    <div className="space-y-2">
                      {[
                        { id: "rsi", label: "RSI (14)", icon: TrendingUp },
                        { id: "macd", label: "MACD", icon: BarChart3 },
                        { id: "stoch", label: "Stochastic", icon: Activity },
                      ].map((indicator) => (
                        <div key={indicator.id} className="flex items-center space-x-2">
                          <Checkbox
                            id={indicator.id}
                            checked={activeIndicators.includes(indicator.id)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setActiveIndicators([...activeIndicators, indicator.id]);
                              } else {
                                setActiveIndicators(activeIndicators.filter((id) => id !== indicator.id));
                              }
                            }}
                          />
                          <Label htmlFor={indicator.id} className="flex items-center gap-2">
                            <indicator.icon className="w-3 h-3" />
                            {indicator.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => setActiveIndicators([])} className="flex-1">
                      Clear All
                    </Button>
                    <Button size="sm" onClick={() => setShowIndicators(false)} className="flex-1">
                      Apply
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showDrawing} onOpenChange={setShowDrawing}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 bg-background/90 backdrop-blur">
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Drawing
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Drawing Tools</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: "trendline", label: "Trend Line", icon: TrendingUp },
                      { id: "horizontal", label: "Horizontal Line", icon: "—" },
                      { id: "vertical", label: "Vertical Line", icon: "|" },
                      { id: "rectangle", label: "Rectangle", icon: "▭" },
                      { id: "fibonacci", label: "Fibonacci", icon: Zap },
                      { id: "arrow", label: "Arrow", icon: "→" },
                    ].map((tool) => (
                      <Button
                        key={tool.id}
                        variant={drawingMode === tool.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => setDrawingMode(drawingMode === tool.id ? null : tool.id)}
                        className="h-12 flex flex-col gap-1"
                      >
                        {typeof tool.icon === "string" ? <span className="text-lg">{tool.icon}</span> : <tool.icon className="w-4 h-4" />}
                        <span className="text-xs">{tool.label}</span>
                      </Button>
                    ))}
                  </div>

                  <Separator />

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setDrawingMode(null)} className="flex-1">
                      Clear Selection
                    </Button>
                    <Button variant="destructive" size="sm" className="flex-1">
                      Clear All Drawings
                    </Button>
                  </div>

                  {drawingMode && (
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        <strong>{drawingMode.charAt(0).toUpperCase() + drawingMode.slice(1)}</strong> tool selected. Click on the chart to start drawing.
                      </p>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
