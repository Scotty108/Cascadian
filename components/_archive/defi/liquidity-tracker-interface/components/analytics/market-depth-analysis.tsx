"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from "recharts"
import { RefreshCw, ExternalLink } from "lucide-react"
import { marketDepthData } from "../../data"

export function MarketDepthAnalysis() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Depth Analysis</CardTitle>
        <CardDescription>Analyze liquidity depth for major token pairs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col md:flex-row justify-between items-center mb-4">
          <div className="flex gap-2 mb-4 md:mb-0">
            <Select defaultValue="eth-usdc">
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Pair" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eth-usdc">ETH-USDC</SelectItem>
                <SelectItem value="btc-usdc">BTC-USDC</SelectItem>
                <SelectItem value="eth-btc">ETH-BTC</SelectItem>
                <SelectItem value="usdc-usdt">USDC-USDT</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue="uniswap">
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Protocol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uniswap">Uniswap</SelectItem>
                <SelectItem value="curve">Curve</SelectItem>
                <SelectItem value="balancer">Balancer</SelectItem>
                <SelectItem value="sushiswap">SushiSwap</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm">
              <ExternalLink className="mr-2 h-4 w-4" />
              View on DEX
            </Button>
          </div>
        </div>

        <ChartContainer
          config={{
            bids: {
              label: "Bids",
              color: "hsl(var(--chart-1))",
            },
            asks: {
              label: "Asks",
              color: "hsl(var(--chart-5))",
            },
          }}
          className="h-[400px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={marketDepthData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="price" />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Legend />
              <Area
                type="monotone"
                dataKey="bids"
                stroke="var(--color-bids)"
                fill="var(--color-bids)"
                fillOpacity={0.3}
              />
              <Area
                type="monotone"
                dataKey="asks"
                stroke="var(--color-asks)"
                fill="var(--color-asks)"
                fillOpacity={0.3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Current Price</div>
            <div className="text-2xl font-bold">$2,045.78</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Slippage (100K USD)</div>
            <div className="text-2xl font-bold">0.42%</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-sm text-muted-foreground">Liquidity Score</div>
            <div className="text-2xl font-bold">8.7/10</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
