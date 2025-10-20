"use client"

import { useState } from "react"
import { ArrowRight, Shield, Clock, Layers, Zap } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { YIELD_OPPORTUNITIES } from "../../constants"
import { getRiskColor, getRiskLabel } from "../../utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/hooks/use-toast"

export function OpportunitiesTab() {
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false)
  const [selectedOpportunity, setSelectedOpportunity] = useState<any>(null)
  const [depositAmount, setDepositAmount] = useState("")
  const [isDepositing, setIsDepositing] = useState(false)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [selectedDetailsOpportunity, setSelectedDetailsOpportunity] = useState<any>(null)
  const [isOptimizationModalOpen, setIsOptimizationModalOpen] = useState(false)
  const [optimizationResults, setOptimizationResults] = useState<any>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)

  const handleDeposit = (opportunity: any) => {
    setSelectedOpportunity(opportunity)
    setIsDepositModalOpen(true)
    setDepositAmount("")
  }

  const handleConfirmDeposit = async () => {
    if (!selectedOpportunity || !depositAmount) {
      toast({
        title: "Error",
        description: "Please enter a valid deposit amount",
        variant: "destructive",
      })
      return
    }

    setIsDepositing(true)

    try {
      // Simulate API call to deposit
      await new Promise((resolve) => setTimeout(resolve, 2000))

      toast({
        title: "Deposit Successful",
        description: `Successfully deposited ${depositAmount} ${selectedOpportunity.asset} to ${selectedOpportunity.protocol}`,
      })

      setIsDepositModalOpen(false)
      setDepositAmount("")
      setSelectedOpportunity(null)
    } catch (error) {
      toast({
        title: "Deposit Failed",
        description: "Failed to process deposit. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsDepositing(false)
    }
  }

  const handleCloseModal = () => {
    setIsDepositModalOpen(false)
    setDepositAmount("")
    setSelectedOpportunity(null)
  }

  const handleViewDetails = (opportunity: any) => {
    setSelectedDetailsOpportunity(opportunity)
    setIsDetailsModalOpen(true)
  }

  const handleCloseDetailsModal = () => {
    setIsDetailsModalOpen(false)
    setSelectedDetailsOpportunity(null)
  }

  const handleOptimizeTransactions = async () => {
    setIsOptimizing(true)
    setIsOptimizationModalOpen(true)

    try {
      // Simulate API call to analyze and optimize transactions
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Mock optimization results
      const results = {
        potentialSavings: {
          gas: "45%",
          fees: "$127.50",
          time: "2.3 hours",
        },
        recommendations: [
          {
            type: "Batch Transactions",
            description: "Combine 3 pending transactions into a single batch",
            savings: "$45.20",
            impact: "high",
          },
          {
            type: "Optimal Timing",
            description: "Execute during low gas periods (2-4 AM UTC)",
            savings: "$32.10",
            impact: "medium",
          },
          {
            type: "Layer 2 Migration",
            description: "Move smaller transactions to Polygon or Arbitrum",
            savings: "$50.20",
            impact: "high",
          },
          {
            type: "Gas Token Usage",
            description: "Use CHI or GST2 tokens for gas optimization",
            savings: "$15.30",
            impact: "low",
          },
        ],
        scheduledTransactions: [
          {
            protocol: "Aave",
            action: "Supply USDC",
            amount: "1,000 USDC",
            estimatedGas: "120,000",
            optimalTime: "3:30 AM UTC",
            savings: "$12.50",
          },
          {
            protocol: "Compound",
            action: "Claim Rewards",
            amount: "45.2 COMP",
            estimatedGas: "85,000",
            optimalTime: "2:15 AM UTC",
            savings: "$8.20",
          },
        ],
      }

      setOptimizationResults(results)

      toast({
        title: "Optimization Complete",
        description: "Found multiple ways to optimize your transactions and save on gas fees.",
      })
    } catch (error) {
      toast({
        title: "Optimization Failed",
        description: "Failed to analyze transactions. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsOptimizing(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Yield Opportunities</CardTitle>
          <CardDescription>Best yield opportunities across protocols</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Protocol</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Strategy</TableHead>
                <TableHead>APY</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Chain</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {YIELD_OPPORTUNITIES.map((opportunity, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={opportunity.protocolIcon || "/placeholder.svg"} alt={opportunity.protocol} />
                        <AvatarFallback>{opportunity.protocol.substring(0, 2)}</AvatarFallback>
                      </Avatar>
                      <span>{opportunity.protocol}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={opportunity.assetIcon || "/placeholder.svg"} alt={opportunity.asset} />
                        <AvatarFallback>{opportunity.asset.substring(0, 2)}</AvatarFallback>
                      </Avatar>
                      <span>{opportunity.asset}</span>
                    </div>
                  </TableCell>
                  <TableCell>{opportunity.strategy}</TableCell>
                  <TableCell>{opportunity.apy}%</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <div className={`h-2 w-2 rounded-full ${getRiskColor(opportunity.risk)}`} />
                      <span className="text-xs">{getRiskLabel(opportunity.risk)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={opportunity.chainIcon || "/placeholder.svg"} alt={opportunity.chain} />
                        <AvatarFallback>{opportunity.chain.substring(0, 2)}</AvatarFallback>
                      </Avatar>
                      <span>{opportunity.chain}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" className="h-8" onClick={() => handleDeposit(opportunity)}>
                      <ArrowRight className="mr-1 h-4 w-4" />
                      <span>Deposit</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Risk-Adjusted Opportunities</CardTitle>
            <CardDescription>Opportunities sorted by risk-adjusted returns</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="risk-tolerance">Risk Tolerance</Label>
                <span className="text-sm font-medium">Medium</span>
              </div>
              <Slider id="risk-tolerance" defaultValue={[50]} max={100} step={1} className="py-4" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Conservative</span>
                <span>Balanced</span>
                <span>Aggressive</span>
              </div>

              <div className="mt-6 space-y-4">
                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src="/aave-logo.png" alt="Aave" />
                        <AvatarFallback>AA</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">Aave - USDC Supply</p>
                        <p className="text-xs text-muted-foreground">Low risk, stable returns</p>
                      </div>
                    </div>
                    <Badge>4.2% APY</Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Shield className="h-4 w-4 text-green-500" />
                      <span className="text-xs">Risk Score: 2/10</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() =>
                        handleViewDetails({
                          protocol: "Aave",
                          asset: "USDC",
                          strategy: "Supply",
                          apy: 4.2,
                          risk: "low",
                          chain: "Ethereum",
                        })
                      }
                    >
                      View Details
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src="/placeholder-h9j1l.png" alt="Curve" />
                        <AvatarFallback>CU</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">Curve - ETH/stETH Pool</p>
                        <p className="text-xs text-muted-foreground">Medium risk, higher returns</p>
                      </div>
                    </div>
                    <Badge>6.8% APY</Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Shield className="h-4 w-4 text-yellow-500" />
                      <span className="text-xs">Risk Score: 5/10</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() =>
                        handleViewDetails({
                          protocol: "Curve",
                          asset: "ETH/stETH",
                          strategy: "Liquidity Pool",
                          apy: 6.8,
                          risk: "medium",
                          chain: "Ethereum",
                        })
                      }
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Gas Optimization</CardTitle>
            <CardDescription>Optimize gas costs for DeFi interactions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <h3 className="font-medium">Current Gas Prices</h3>
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-md bg-muted p-2 text-center">
                    <p className="text-xs text-muted-foreground">Slow</p>
                    <p className="font-medium">12 Gwei</p>
                  </div>
                  <div className="rounded-md bg-muted p-2 text-center">
                    <p className="text-xs text-muted-foreground">Average</p>
                    <p className="font-medium">15 Gwei</p>
                  </div>
                  <div className="rounded-md bg-muted p-2 text-center">
                    <p className="text-xs text-muted-foreground">Fast</p>
                    <p className="font-medium">18 Gwei</p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="font-medium">Gas Saving Recommendations</h3>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between rounded-md bg-muted p-2">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Wait for off-peak hours</span>
                    </div>
                    <Badge variant="outline">Save ~30%</Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted p-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Use Layer 2 solutions</span>
                    </div>
                    <Badge variant="outline">Save ~90%</Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-muted p-2">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Batch transactions</span>
                    </div>
                    <Badge variant="outline">Save ~50%</Badge>
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={handleOptimizeTransactions} disabled={isOptimizing}>
                {isOptimizing ? "Analyzing..." : "Optimize My Transactions"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Deposit Modal */}
      <Dialog open={isDepositModalOpen} onOpenChange={setIsDepositModalOpen}>
        <DialogContent className="sm:max-w-[425px] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Deposit to {selectedOpportunity?.protocol}</DialogTitle>
            <DialogDescription>
              Deposit {selectedOpportunity?.asset} to earn {selectedOpportunity?.apy}% APY
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="deposit-amount">Amount</Label>
              <div className="relative">
                <Input
                  id="deposit-amount"
                  type="number"
                  placeholder="0.00"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="pr-16"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {selectedOpportunity?.asset}
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-muted p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Protocol:</span>
                <span className="font-medium">{selectedOpportunity?.protocol}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Strategy:</span>
                <span className="font-medium">{selectedOpportunity?.strategy}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>APY:</span>
                <span className="font-medium text-green-600">{selectedOpportunity?.apy}%</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Risk Level:</span>
                <div className="flex items-center gap-1">
                  <div
                    className={`h-2 w-2 rounded-full ${selectedOpportunity ? getRiskColor(selectedOpportunity.risk) : ""}`}
                  />
                  <span className="font-medium">
                    {selectedOpportunity ? getRiskLabel(selectedOpportunity.risk) : ""}
                  </span>
                </div>
              </div>
            </div>

            {depositAmount && (
              <div className="rounded-lg bg-green-50 p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Estimated Annual Earnings:</span>
                  <span className="font-medium text-green-600">
                    {((Number.parseFloat(depositAmount) * (selectedOpportunity?.apy || 0)) / 100).toFixed(4)}{" "}
                    {selectedOpportunity?.asset}
                  </span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseModal} disabled={isDepositing}>
              Cancel
            </Button>
            <Button onClick={handleConfirmDeposit} disabled={isDepositing || !depositAmount}>
              {isDepositing ? "Depositing..." : "Confirm Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Modal */}
      <Dialog open={isDetailsModalOpen} onOpenChange={setIsDetailsModalOpen}>
        <DialogContent className="sm:max-w-[425px] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedDetailsOpportunity?.protocol} - {selectedDetailsOpportunity?.asset}
            </DialogTitle>
            <DialogDescription>Detailed information about this yield opportunity</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Overview Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Overview</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Protocol</Label>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src="/placeholder.svg" alt={selectedDetailsOpportunity?.protocol} />
                      <AvatarFallback>{selectedDetailsOpportunity?.protocol?.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{selectedDetailsOpportunity?.protocol}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Asset</Label>
                  <span className="font-medium">{selectedDetailsOpportunity?.asset}</span>
                </div>
                <div className="space-y-2">
                  <Label>Strategy</Label>
                  <span className="font-medium">{selectedDetailsOpportunity?.strategy}</span>
                </div>
                <div className="space-y-2">
                  <Label>Chain</Label>
                  <span className="font-medium">{selectedDetailsOpportunity?.chain}</span>
                </div>
              </div>
            </div>

            {/* Performance Metrics */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Performance Metrics</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{selectedDetailsOpportunity?.apy}%</div>
                  <div className="text-sm text-muted-foreground">Current APY</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">$2.4M</div>
                  <div className="text-sm text-muted-foreground">Total Value Locked</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">98.5%</div>
                  <div className="text-sm text-muted-foreground">Utilization Rate</div>
                </div>
              </div>
            </div>

            {/* Risk Assessment */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Risk Assessment</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span>Smart Contract Risk</span>
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-2 w-2 rounded-full ${selectedDetailsOpportunity?.risk === "low" ? "bg-green-500" : "bg-yellow-500"}`}
                    />
                    <span className="text-sm">{selectedDetailsOpportunity?.risk === "low" ? "Low" : "Medium"}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>Liquidity Risk</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-sm">Low</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>Market Risk</span>
                  <div className="flex items-center gap-2">
                    <div
                      className={`h-2 w-2 rounded-full ${selectedDetailsOpportunity?.risk === "low" ? "bg-green-500" : "bg-yellow-500"}`}
                    />
                    <span className="text-sm">{selectedDetailsOpportunity?.risk === "low" ? "Low" : "Medium"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Historical Performance */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Historical Performance</h3>
              <div className="rounded-lg border p-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>7-day average APY:</span>
                    <span className="font-medium">{(selectedDetailsOpportunity?.apy - 0.2).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>30-day average APY:</span>
                    <span className="font-medium">{(selectedDetailsOpportunity?.apy - 0.5).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>All-time high APY:</span>
                    <span className="font-medium">{(selectedDetailsOpportunity?.apy + 2.1).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Additional Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Minimum Deposit:</span>
                  <span className="font-medium">0.01 {selectedDetailsOpportunity?.asset}</span>
                </div>
                <div className="flex justify-between">
                  <span>Lock Period:</span>
                  <span className="font-medium">None</span>
                </div>
                <div className="flex justify-between">
                  <span>Withdrawal Fee:</span>
                  <span className="font-medium">0%</span>
                </div>
                <div className="flex justify-between">
                  <span>Compound Frequency:</span>
                  <span className="font-medium">Daily</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDetailsModal}>
              Close
            </Button>
            <Button
              onClick={() => {
                handleCloseDetailsModal()
                handleDeposit(selectedDetailsOpportunity)
              }}
            >
              Deposit Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction Optimization Modal */}
      <Dialog open={isOptimizationModalOpen} onOpenChange={setIsOptimizationModalOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transaction Optimization</DialogTitle>
            <DialogDescription>
              AI-powered analysis to optimize your DeFi transactions and reduce gas costs
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {isOptimizing ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center space-y-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                  <p className="text-sm text-muted-foreground">Analyzing your transactions...</p>
                </div>
              </div>
            ) : optimizationResults ? (
              <>
                {/* Potential Savings Overview */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{optimizationResults.potentialSavings.gas}</div>
                    <div className="text-sm text-muted-foreground">Gas Savings</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{optimizationResults.potentialSavings.fees}</div>
                    <div className="text-sm text-muted-foreground">Fee Savings</div>
                  </div>
                  <div className="rounded-lg border p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{optimizationResults.potentialSavings.time}</div>
                    <div className="text-sm text-muted-foreground">Time Saved</div>
                  </div>
                </div>

                {/* Optimization Recommendations */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Optimization Recommendations</h3>
                  <div className="space-y-3">
                    {optimizationResults.recommendations.map((rec: any, index: number) => (
                      <div key={index} className="rounded-lg border p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className={`h-3 w-3 rounded-full ${
                                rec.impact === "high"
                                  ? "bg-red-500"
                                  : rec.impact === "medium"
                                    ? "bg-yellow-500"
                                    : "bg-green-500"
                              }`}
                            />
                            <div>
                              <p className="font-medium">{rec.type}</p>
                              <p className="text-sm text-muted-foreground">{rec.description}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-medium text-green-600">{rec.savings}</div>
                            <div className="text-xs text-muted-foreground capitalize">{rec.impact} Impact</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Scheduled Transactions */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">Optimized Transaction Schedule</h3>
                  <div className="space-y-3">
                    {optimizationResults.scheduledTransactions.map((tx: any, index: number) => (
                      <div key={index} className="rounded-lg border p-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{tx.protocol}</span>
                              <Badge variant="outline">{tx.action}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">Amount: {tx.amount}</p>
                            <p className="text-sm text-muted-foreground">Estimated Gas: {tx.estimatedGas}</p>
                          </div>
                          <div className="text-right space-y-1">
                            <div className="font-medium">{tx.optimalTime}</div>
                            <div className="text-sm text-green-600">Save {tx.savings}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={() => {
                      toast({
                        title: "Optimization Applied",
                        description: "Your transactions have been scheduled for optimal execution.",
                      })
                      setIsOptimizationModalOpen(false)
                    }}
                  >
                    Apply Optimizations
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 bg-transparent"
                    onClick={() => {
                      toast({
                        title: "Schedule Created",
                        description: "Transaction schedule saved. You'll be notified at optimal times.",
                      })
                      setIsOptimizationModalOpen(false)
                    }}
                  >
                    Schedule Transactions
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  Click &quot;Analyze Transactions&quot; to get optimization recommendations.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOptimizationModalOpen(false)}>
              Close
            </Button>
            {!isOptimizing && !optimizationResults && (
              <Button onClick={handleOptimizeTransactions}>Analyze Transactions</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
