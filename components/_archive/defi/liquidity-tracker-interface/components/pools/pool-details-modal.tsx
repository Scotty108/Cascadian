"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"
import { TrendingUp, TrendingDown, AlertTriangle, Info, Star } from "lucide-react"
import type { LiquidityPool } from "../../types"

interface PoolDetailsModalProps {
  pool: LiquidityPool | null
  isOpen: boolean
  onClose: () => void
  onAddLiquidity: (pool: LiquidityPool) => void
  onToggleFavorite: (poolId: string) => void
  isFavorite: boolean
}

const mockApyData = [
  { date: "Jan", apy: 12.5 },
  { date: "Feb", apy: 15.2 },
  { date: "Mar", apy: 18.7 },
  { date: "Apr", apy: 16.3 },
  { date: "May", apy: 19.8 },
  { date: "Jun", apy: 22.1 },
]

const mockVolumeData = [
  { date: "Jan", volume: 2.5 },
  { date: "Feb", volume: 3.2 },
  { date: "Mar", volume: 4.1 },
  { date: "Apr", volume: 3.8 },
  { date: "May", volume: 5.2 },
  { date: "Jun", volume: 6.1 },
]

export function PoolDetailsModal({
  pool,
  isOpen,
  onClose,
  onAddLiquidity,
  onToggleFavorite,
  isFavorite,
}: PoolDetailsModalProps) {
  const [activeTab, setActiveTab] = useState("overview")

  if (!pool) return null

  const handleAddLiquidity = () => {
    onAddLiquidity(pool)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-2xl">{pool.name}</DialogTitle>
              <Badge variant="outline">{pool.protocol}</Badge>
              <Badge variant="secondary">{pool.chain || "Ethereum"}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onToggleFavorite(`${pool.id}`)}>
                <Star className={`h-4 w-4 ${isFavorite ? "fill-yellow-400 text-yellow-400" : ""}`} />
              </Button>
              <Button onClick={handleAddLiquidity}>Add Liquidity</Button>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="risks">Risks</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Value Locked</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{pool.tvl}</div>
                  <div className="flex items-center text-sm text-green-600">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    +12.5% (24h)
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>APY</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{pool.apy}</div>
                  <div className="text-sm text-muted-foreground">Current yield</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>24h Volume</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{pool.volume24h}</div>
                  <div className="flex items-center text-sm text-red-600">
                    <TrendingDown className="h-3 w-3 mr-1" />
                    -5.2% (24h)
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Fee Tier</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{pool.fee}</div>
                  <div className="text-sm text-muted-foreground">Trading fee</div>
                </CardContent>
              </Card>
            </div>

            {/* Pool Composition */}
            <Card>
              <CardHeader>
                <CardTitle>Pool Composition</CardTitle>
                <CardDescription>Token distribution and reserves</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                      B
                    </div>
                    <div>
                      <div className="font-medium">BTC</div>
                      <div className="text-sm text-muted-foreground">Bitcoin</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">1,234.56 BTC</div>
                    <div className="text-sm text-muted-foreground">50.2%</div>
                  </div>
                </div>
                <Progress value={50.2} className="h-2" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
                      E
                    </div>
                    <div>
                      <div className="font-medium">ETH</div>
                      <div className="text-sm text-muted-foreground">Ethereum</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">18,765.43 ETH</div>
                    <div className="text-sm text-muted-foreground">49.8%</div>
                  </div>
                </div>
                <Progress value={49.8} className="h-2" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>APY Trends</CardTitle>
                  <CardDescription>Historical APY performance</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={mockApyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip formatter={(value) => [`${value}%`, "APY"]} />
                      <Line type="monotone" dataKey="apy" stroke="#22c55e" strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Volume Trends</CardTitle>
                  <CardDescription>Trading volume over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={mockVolumeData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip formatter={(value) => [`$${value}M`, "Volume"]} />
                      <Area type="monotone" dataKey="volume" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="risks" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                  Risk Assessment
                </CardTitle>
                <CardDescription>Understand the risks before providing liquidity</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span>Impermanent Loss Risk</span>
                    <Badge variant="destructive">{pool.impermanentLoss}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Smart Contract Risk</span>
                    <Badge variant="secondary">Medium</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Liquidity Risk</span>
                    <Badge variant="outline">Low</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Overall Risk Level</span>
                    <Badge
                      variant={pool.risk === "High" ? "destructive" : pool.risk === "Medium" ? "secondary" : "outline"}
                    >
                      {pool.risk}
                    </Badge>
                  </div>
                </div>

                <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-yellow-600 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-yellow-800 dark:text-yellow-200">Impermanent Loss Warning</p>
                      <p className="text-yellow-700 dark:text-yellow-300 mt-1">
                        This pool has high impermanent loss risk due to volatile token pairs. Consider the potential
                        loss before providing liquidity.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Recent Transactions</CardTitle>
                <CardDescription>Latest pool activity</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { type: "Add", amount: "$12,500", user: "0x1234...5678", time: "2 mins ago" },
                    { type: "Remove", amount: "$8,200", user: "0x9876...5432", time: "15 mins ago" },
                    { type: "Swap", amount: "$3,400", user: "0x5555...1111", time: "1 hour ago" },
                    { type: "Add", amount: "$25,000", user: "0x7777...9999", time: "2 hours ago" },
                  ].map((tx, index) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={tx.type === "Add" ? "default" : tx.type === "Remove" ? "destructive" : "secondary"}
                        >
                          {tx.type}
                        </Badge>
                        <span className="font-medium">{tx.amount}</span>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        <div>{tx.user}</div>
                        <div>{tx.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
