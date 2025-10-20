"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
  AreaChart,
  Area,
} from "recharts"
import { historicalApyData } from "../data"

// Mock staking performance data
const stakingPerformanceData = [
  { date: "Jan", totalStaked: 100000, rewards: 0, value: 100000 },
  { date: "Feb", totalStaked: 102000, rewards: 2000, value: 102000 },
  { date: "Mar", totalStaked: 104500, rewards: 4500, value: 104500 },
  { date: "Apr", totalStaked: 106800, rewards: 6800, value: 106800 },
  { date: "May", totalStaked: 109200, rewards: 9200, value: 109200 },
  { date: "Jun", totalStaked: 111800, rewards: 11800, value: 111800 },
  { date: "Jul", totalStaked: 114600, rewards: 14600, value: 114600 },
  { date: "Aug", totalStaked: 117500, rewards: 17500, value: 117500 },
  { date: "Sep", totalStaked: 120600, rewards: 20600, value: 120600 },
  { date: "Oct", totalStaked: 123900, rewards: 23900, value: 123900 },
  { date: "Nov", totalStaked: 127400, rewards: 27400, value: 127400 },
  { date: "Dec", totalStaked: 131000, rewards: 31000, value: 131000 },
]

export function AnalyticsTab() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>APY Comparison</CardTitle>
            <CardDescription>Compare APY across different staking protocols</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historicalApyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis tickFormatter={(value) => `${value}%`} />
                  <RechartsTooltip formatter={(value) => [`${value}%`, "APY"]} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="apy"
                    name="Ethereum"
                    stroke="#627EEA"
                    strokeWidth={2}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="apy"
                    name="Solana"
                    stroke="#00FFA3"
                    strokeWidth={2}
                    activeDot={{ r: 6 }}
                    data={historicalApyData.map((item) => ({ ...item, apy: item.apy * 1.5 }))}
                  />
                  <Line
                    type="monotone"
                    dataKey="apy"
                    name="BNB Chain"
                    stroke="#F3BA2F"
                    strokeWidth={2}
                    activeDot={{ r: 6 }}
                    data={historicalApyData.map((item) => ({ ...item, apy: item.apy * 1.2 }))}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk vs. Reward</CardTitle>
            <CardDescription>Analyze the risk-reward profile of staking options</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart
                  data={[
                    { name: "Ethereum 2.0", apy: 4.2, risk: 2, tvl: 28500000000 },
                    { name: "Lido stETH", apy: 3.8, risk: 3, tvl: 21300000000 },
                    { name: "Rocket Pool", apy: 4.1, risk: 3, tvl: 2800000000 },
                    { name: "BNB Staking", apy: 6.5, risk: 5, tvl: 3200000000 },
                    { name: "Solana", apy: 7.8, risk: 6, tvl: 4100000000 },
                    { name: "Marinade SOL", apy: 6.9, risk: 5, tvl: 580000000 },
                    { name: "Polkadot", apy: 14.2, risk: 7, tvl: 1900000000 },
                    { name: "Cardano", apy: 5.2, risk: 3, tvl: 2700000000 },
                    { name: "Cosmos", apy: 19.5, risk: 8, tvl: 980000000 },
                    { name: "Aave Safety", apy: 7.3, risk: 4, tvl: 120000000 },
                  ]}
                  margin={{
                    top: 20,
                    right: 20,
                    bottom: 20,
                    left: 20,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="risk"
                    name="Risk Level"
                    domain={[0, 10]}
                    tickFormatter={(value) => `${value}/10`}
                  />
                  <YAxis type="number" dataKey="apy" name="APY" tickFormatter={(value) => `${value}%`} />
                  <RechartsTooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload
                        return (
                          <div className="bg-background border rounded-lg p-3 shadow-lg">
                            <p className="font-medium">{data.name}</p>
                            <p className="text-sm text-muted-foreground">
                              APY: <span className="text-green-600">{data.apy}%</span>
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Risk: <span className="text-orange-600">{data.risk}/10</span>
                            </p>
                            <p className="text-sm text-muted-foreground">
                              TVL: <span className="text-blue-600">${(data.tvl / 1000000).toFixed(0)}M</span>
                            </p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Scatter name="Staking Pools" fill="#8884d8">
                    {[
                      { name: "Ethereum 2.0", apy: 4.2, risk: 2, tvl: 28500000000 },
                      { name: "Lido stETH", apy: 3.8, risk: 3, tvl: 21300000000 },
                      { name: "Rocket Pool", apy: 4.1, risk: 3, tvl: 2800000000 },
                      { name: "BNB Staking", apy: 6.5, risk: 5, tvl: 3200000000 },
                      { name: "Solana", apy: 7.8, risk: 6, tvl: 4100000000 },
                      { name: "Marinade SOL", apy: 6.9, risk: 5, tvl: 580000000 },
                      { name: "Polkadot", apy: 14.2, risk: 7, tvl: 1900000000 },
                      { name: "Cardano", apy: 5.2, risk: 3, tvl: 2700000000 },
                      { name: "Cosmos", apy: 19.5, risk: 8, tvl: 980000000 },
                      { name: "Aave Safety", apy: 7.3, risk: 4, tvl: 120000000 },
                    ].map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.risk <= 3 ? "#22c55e" : entry.risk <= 6 ? "#f59e0b" : "#ef4444"}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Staking Performance</CardTitle>
          <CardDescription>Track your staking performance over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stakingPerformanceData}>
                <defs>
                  <linearGradient id="totalStaked" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rewards" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`} />
                <RechartsTooltip
                  formatter={(value, name) => [
                    `$${Number(value).toLocaleString()}`,
                    name === "totalStaked" ? "Total Staked" : "Total Rewards",
                  ]}
                  labelFormatter={(label) => `Month: ${label}`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="totalStaked"
                  stackId="1"
                  stroke="#3b82f6"
                  fill="url(#totalStaked)"
                  name="Total Staked"
                />
                <Area
                  type="monotone"
                  dataKey="rewards"
                  stackId="2"
                  stroke="#10b981"
                  fill="url(#rewards)"
                  name="Total Rewards"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Market Insights</CardTitle>
          <CardDescription>Staking trends and market analysis</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Total Value Staked</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">$68.4B</div>
                  <p className="text-xs text-green-500">+2.3% this week</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Average Network APY</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">5.8%</div>
                  <p className="text-xs text-red-500">-0.2% this week</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Staking Ratio</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">32.7%</div>
                  <p className="text-xs text-green-500">+1.1% this week</p>
                </CardContent>
              </Card>
            </div>

            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>Staking Market Trends</AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground mb-2">
                    Liquid staking derivatives continue to gain market share, now representing over 40% of all staked
                    ETH. The trend toward liquid staking solutions is expected to continue as users seek flexibility
                    while earning staking rewards.
                  </p>
                  <p className="text-muted-foreground">
                    Proof of Stake networks are seeing increased adoption, with more chains transitioning from other
                    consensus mechanisms to capture the growing interest in staking.
                  </p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-2">
                <AccordionTrigger>Regulatory Landscape</AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground">
                    Regulatory clarity around staking continues to evolve. Some jurisdictions are beginning to provide
                    clearer guidelines on the tax treatment of staking rewards, while others are still developing their
                    approach.
                  </p>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="item-3">
                <AccordionTrigger>Technology Developments</AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground">
                    Innovations in staking infrastructure are reducing the technical barriers to participation. New
                    solutions for distributed validator technology and restaking are expanding the possibilities for
                    capital efficiency in staking.
                  </p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
