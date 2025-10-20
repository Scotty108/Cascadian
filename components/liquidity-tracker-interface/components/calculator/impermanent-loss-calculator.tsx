"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, ResponsiveContainer } from "recharts"
import { impermanentLossData } from "../../data"

export function ImpermanentLossCalculator() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Impermanent Loss Calculator</CardTitle>
        <CardDescription>Calculate potential impermanent loss for different price scenarios</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Token Pair</Label>
              <Select defaultValue="eth-usdc">
                <SelectTrigger>
                  <SelectValue placeholder="Select Token Pair" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eth-usdc">ETH-USDC</SelectItem>
                  <SelectItem value="btc-usdc">BTC-USDC</SelectItem>
                  <SelectItem value="eth-btc">ETH-BTC</SelectItem>
                  <SelectItem value="usdc-usdt">USDC-USDT</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Initial Prices</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="ETH Price" defaultValue="2050" />
                <Input placeholder="USDC Price" defaultValue="1" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>New Prices</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input placeholder="ETH Price" defaultValue="2250" />
                <Input placeholder="USDC Price" defaultValue="1" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Fee Tier</Label>
              <Select defaultValue="0.3">
                <SelectTrigger>
                  <SelectValue placeholder="Select Fee Tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.01">0.01%</SelectItem>
                  <SelectItem value="0.05">0.05%</SelectItem>
                  <SelectItem value="0.3">0.3%</SelectItem>
                  <SelectItem value="1">1%</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Time Period (Days)</Label>
              <Input type="number" defaultValue="30" />
            </div>

            <Button className="w-full">Calculate Impermanent Loss</Button>
          </div>

          <div className="space-y-4 border rounded-lg p-4">
            <h3 className="text-lg font-medium">Impermanent Loss Analysis</h3>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Price Change</div>
              <div className="text-2xl font-bold">+9.8%</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Impermanent Loss</div>
              <div className="text-2xl font-bold text-red-500">-0.9%</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Estimated Fee Earnings</div>
              <div className="text-2xl font-bold text-green-500">+1.2%</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Net Position</div>
              <div className="text-2xl font-bold text-green-500">+0.3%</div>
            </div>

            <div className="mt-4">
              <ChartContainer
                config={{
                  il: {
                    label: "Impermanent Loss",
                    color: "hsl(var(--chart-5))",
                  },
                  fees: {
                    label: "Fee Earnings",
                    color: "hsl(var(--chart-3))",
                  },
                  net: {
                    label: "Net Position",
                    color: "hsl(var(--chart-1))",
                  },
                }}
                className="h-[200px]"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={impermanentLossData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="priceChange" />
                    <YAxis />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Line type="monotone" dataKey="il" stroke="var(--color-il)" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
