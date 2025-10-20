"use client";

import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Check, ChevronDown, Clock, ExternalLink, Loader2, Lock, Plus, RefreshCw, Sparkles, Wallet, X } from "lucide-react";
import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip as RechartsTooltip, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { activeStakes, historicalApyData } from "../data";
import { formatNumber, formatPercent } from "../utils";

export function MyStakesTab() {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [selectedStake, setSelectedStake] = useState<any>(null);
  const [addAmount, setAddAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleAdd = (stake: any) => {
    setSelectedStake(stake);
    setAddModalOpen(true);
  };

  const handleClaim = async (stake: any) => {
    setIsLoading(true);
    setSelectedStake(stake);

    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setClaimModalOpen(true);
    }, 1000);
  };

  const handleWithdraw = (stake: any) => {
    setSelectedStake(stake);
    setWithdrawModalOpen(true);
  };

  const handleConfirmAdd = async () => {
    if (!addAmount || Number.parseFloat(addAmount) <= 0) return;

    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setAddModalOpen(false);
      setAddAmount("");
      setSelectedStake(null);
    }, 2000);
  };

  const handleConfirmWithdraw = async () => {
    if (!withdrawAmount || Number.parseFloat(withdrawAmount) <= 0) return;

    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setWithdrawModalOpen(false);
      setWithdrawAmount("");
      setSelectedStake(null);
    }, 2000);
  };

  const setMaxAdd = () => {
    // Simulate getting wallet balance
    setAddAmount("1000");
  };

  const setMaxWithdraw = () => {
    if (selectedStake) {
      setWithdrawAmount(selectedStake.stakedAmount.toString());
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Active Staking Positions</CardTitle>
          <CardDescription>Manage your current staking positions and rewards</CardDescription>
        </CardHeader>
        <CardContent>
          {activeStakes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No active stakes</h3>
              <p className="text-muted-foreground mb-4">You don&apos;t have any active staking positions yet</p>
              <Button>Discover Staking Opportunities</Button>
            </div>
          ) : (
            <div className="space-y-4">
              {activeStakes.map((stake) => (
                <Card key={stake.id}>
                  <div className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={stake.tokenLogo || "/placeholder.svg"} alt={stake.token} />
                          <AvatarFallback>{stake.tokenSymbol.substring(0, 2)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-medium">{stake.poolName}</h3>
                          <div className="flex items-center text-sm text-muted-foreground">
                            <Image src={stake.chainLogo || "/placeholder.svg"} alt={stake.chain} width={12} height={12} className="w-3 h-3 mr-1" />
                            {stake.chain} • {stake.protocol}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap mt-4 md:mt-0">
                        <Button variant="outline" size="sm" onClick={() => handleAdd(stake)} disabled={isLoading}>
                          {isLoading && selectedStake?.id === stake.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                          Add
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleClaim(stake)}
                          disabled={isLoading || stake.rewards === 0}
                          className={stake.rewards > 0 ? "border-green-500 text-green-600 dark:hover:bg-green-600 hover:bg-green-50" : ""}
                        >
                          {isLoading && selectedStake?.id === stake.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                          Claim
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleWithdraw(stake)} disabled={isLoading || stake.isLocked}>
                          {isLoading && selectedStake?.id === stake.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                          Withdraw
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Refresh Data
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View on Explorer
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-500">
                              <X className="h-4 w-4 mr-2" />
                              Remove from List
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Staked Amount</div>
                        <div className="font-medium">
                          {stake.stakedAmount} {stake.tokenSymbol}
                        </div>
                        <div className="text-sm text-muted-foreground">{formatNumber(stake.stakedValue)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Rewards</div>
                        <div className="font-medium text-green-500">
                          {stake.rewards} {stake.rewardToken}
                        </div>
                        <div className="text-sm text-muted-foreground">{formatNumber(stake.rewardsValue)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">APY</div>
                        <div className="font-medium text-green-500">{formatPercent(stake.apy)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Status</div>
                        <div className="font-medium flex items-center">
                          {stake.isLocked ? (
                            <>
                              <Lock className="h-3 w-3 mr-1" />
                              <span>Locked ({stake.remainingLockTime} days left)</span>
                            </>
                          ) : (
                            <>
                              <Check className="h-3 w-3 mr-1 text-green-500" />
                              <span>Unlocked</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="text-sm text-muted-foreground mb-1">Staking Period</div>
                      <div className="flex items-center flex-wrap gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span>Started: {stake.startDate}</span>
                        {stake.endDate && (
                          <>
                            <span>•</span>
                            <span>Ends: {stake.endDate}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reward History</CardTitle>
          <CardDescription>Track your staking rewards over time</CardDescription>
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
                <Line type="monotone" dataKey="apy" name="Average APY" stroke="#10b981" activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Add Stake Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Stake</DialogTitle>
            <DialogDescription>Add more tokens to your {selectedStake?.poolName} position</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Current APY:</span>
                <span className="ml-2 font-medium text-green-600">{selectedStake && formatPercent(selectedStake.apy)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Current Stake:</span>
                <span className="ml-2 font-medium">
                  {selectedStake?.stakedAmount} {selectedStake?.tokenSymbol}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="add-amount">Amount to Add</Label>
              <div className="flex gap-2">
                <Input id="add-amount" type="number" placeholder="0.0" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} />
                <Button variant="outline" onClick={setMaxAdd}>
                  Max
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">Available balance: 1,000 {selectedStake?.tokenSymbol}</p>
            </div>

            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> Adding to your stake will compound your existing rewards and reset your staking period.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAddModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmAdd} disabled={!addAmount || Number.parseFloat(addAmount) <= 0 || isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  `Add ${addAmount || "0"} ${selectedStake?.tokenSymbol || ""}`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Claim Rewards Modal */}
      <Dialog open={claimModalOpen} onOpenChange={setClaimModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Claim Rewards</DialogTitle>
            <DialogDescription>Claim your accumulated rewards from {selectedStake?.poolName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-center py-6">
              <div className="text-3xl font-bold text-green-600 mb-2">
                {selectedStake?.rewards} {selectedStake?.rewardToken}
              </div>
              <div className="text-lg text-muted-foreground">≈ {selectedStake && formatNumber(selectedStake.rewardsValue)}</div>
            </div>

            <div className="bg-green-50 p-3 rounded-lg">
              <p className="text-sm text-green-800">
                <strong>Success!</strong> Your rewards have been claimed and will be transferred to your wallet.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button onClick={() => setClaimModalOpen(false)}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Withdraw Modal */}
      <Dialog open={withdrawModalOpen} onOpenChange={setWithdrawModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Stake</DialogTitle>
            <DialogDescription>Withdraw tokens from your {selectedStake?.poolName} position</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Available:</span>
                <span className="ml-2 font-medium">
                  {selectedStake?.stakedAmount} {selectedStake?.tokenSymbol}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Pending Rewards:</span>
                <span className="ml-2 font-medium text-green-600">
                  {selectedStake?.rewards} {selectedStake?.rewardToken}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">Amount to Withdraw</Label>
              <div className="flex gap-2">
                <Input id="withdraw-amount" type="number" placeholder="0.0" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} />
                <Button variant="outline" onClick={setMaxWithdraw}>
                  Max
                </Button>
              </div>
            </div>

            {selectedStake?.isLocked && (
              <div className="bg-yellow-50 p-3 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Warning:</strong> This position is locked for {selectedStake.remainingLockTime} more days. Early withdrawal may incur penalties.
                </p>
              </div>
            )}

            <div className="bg-red-50 p-3 rounded-lg">
              <p className="text-sm text-red-800">
                <strong>Note:</strong> Withdrawing will also claim any pending rewards. This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setWithdrawModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmWithdraw} disabled={!withdrawAmount || Number.parseFloat(withdrawAmount) <= 0 || isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Withdrawing...
                  </>
                ) : (
                  `Withdraw ${withdrawAmount || "0"} ${selectedStake?.tokenSymbol || ""}`
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
