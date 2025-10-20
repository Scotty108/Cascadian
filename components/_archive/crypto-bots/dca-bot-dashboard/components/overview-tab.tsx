"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Edit, Eye, Pause, Play } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { mockAssets, mockPerformanceData } from "../data";
import type { DcaBot } from "../types";
import { formatCurrency, formatDate, formatPercentage, getProfitColor, getStatusBadgeVariant } from "../utils";

interface OverviewTabProps {
  bots: DcaBot[];
  selectedBot: DcaBot | null;
  onViewDetails: (bot: DcaBot) => void;
  onEditBot: (bot: DcaBot) => void;
  onToggleStatus: (botId: string) => void;
  onSelectBot: (bot: DcaBot) => void;
}

export function OverviewTab({ bots, selectedBot, onViewDetails, onEditBot, onToggleStatus, onSelectBot }: OverviewTabProps) {
  return (
    <div className="space-y-4">
      {/* Performance Chart */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h3 className="text-lg font-medium">DCA Performance Overview</h3>
              <p className="text-sm text-muted-foreground">Track the performance of your dollar cost averaging strategies</p>
            </div>
            <div className="flex items-center gap-2">
              <Select defaultValue="7d">
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Time period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">24 hours</SelectItem>
                  <SelectItem value="7d">7 days</SelectItem>
                  <SelectItem value="30d">30 days</SelectItem>
                  <SelectItem value="90d">90 days</SelectItem>
                  <SelectItem value="1y">1 year</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#8884d8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Purchases */}
          <div className="mt-6">
            <div className="mb-4 flex items-center justify-between">
              <h4 className="font-medium">Recent Purchases</h4>
            </div>
            <div className="overflow-x-auto">
              <Table className="rounded-md border  min-w-[400px]">
                <TableHeader className="grid grid-cols-6 gap-4 border-b p-3 text-xs font-medium text-muted-foreground">
                  <TableRow>
                    <TableHead>Bot</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="h-[200px]">
                    {bots.flatMap((bot) =>
                      bot.history.slice(0, 2).map((entry, index) => (
                  <TableRow key={`${bot.id}-${index}`}>

                        <TableCell  className="grid grid-cols-6 gap-4 border-b p-3 text-sm last:border-0">
                          <div className="flex items-center gap-2">
                            <Badge variant={getStatusBadgeVariant(bot.status)} className="h-2 w-2 p-0" />
                            <span className="truncate">{bot.name}</span>
                          </div>
                          <div>{entry.date}</div>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={mockAssets.find((a) => a.symbol === bot.asset)?.logo || "/placeholder.svg?height=20&width=20" || "/placeholder.svg"} alt={bot.asset} />
                              <AvatarFallback>{bot.asset.substring(0, 2)}</AvatarFallback>
                            </Avatar>
                            <span>{bot.asset}</span>
                          </div>
                          <div>{formatCurrency(entry.price)}</div>
                          <div>{entry.amount}</div>
                          <div>{formatCurrency(entry.value)}</div>
                        </TableCell>
                  </TableRow>
                      ))
                    )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Bots Summary */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {bots.map((bot) => (
          <Card
            key={bot.id}
            className={cn(bot.status === "paused" && "opacity-80", selectedBot?.id === bot.id && "ring-2 ring-primary", "cursor-pointer transition-all hover:shadow-md")}
            onClick={() => onSelectBot(bot)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={mockAssets.find((a) => a.symbol === bot.asset)?.logo || "/placeholder.svg?height=24&width=24"} alt={bot.asset} />
                    <AvatarFallback>{bot.asset.substring(0, 2)}</AvatarFallback>
                  </Avatar>
                  <CardTitle className="text-base">{bot.name}</CardTitle>
                </div>
                <Badge variant={getStatusBadgeVariant(bot.status)}>{bot.status === "active" ? "Active" : "Paused"}</Badge>
              </div>
              <CardDescription className="mt-1">
                {bot.frequency} • {formatCurrency(bot.amount)} • {bot.exchange}
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Invested</p>
                  <p className="font-medium">{formatCurrency(bot.totalInvested)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg. Price</p>
                  <p className="font-medium">{formatCurrency(bot.averagePrice)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Profit/Loss</p>
                  <p className={cn("font-medium", getProfitColor(bot.profit))}>{formatPercentage(bot.profit)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Next Buy</p>
                  <p className="font-medium">{formatDate(bot.nextExecution)}</p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between pt-2">
              <Button variant="ghost" size="sm" onClick={() => onViewDetails(bot)}>
                <Eye className="mr-1 h-3 w-3" />
                Details
              </Button>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onToggleStatus(bot.id)} aria-label={bot.status === "active" ? "Pause bot" : "Activate bot"}>
                  {bot.status === "active" ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditBot(bot)} aria-label="Edit bot">
                  <Edit className="h-3 w-3" />
                </Button>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
      {/* Bot Details */}
      {selectedBot && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={mockAssets.find((a) => a.symbol === selectedBot.asset)?.logo || "/placeholder.svg?height=32&width=32"} alt={selectedBot.asset} />
                  <AvatarFallback>{selectedBot.asset.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle>{selectedBot.name}</CardTitle>
                  <CardDescription>
                    Created on{" "}
                    {new Date(selectedBot.createdAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => onEditBot(selectedBot)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button variant={selectedBot.status === "active" ? "outline" : "default"} size="sm" onClick={() => onToggleStatus(selectedBot.id)}>
                  {selectedBot.status === "active" ? (
                    <>
                      <Pause className="mr-2 h-4 w-4" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Activate
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 grid-cols-1 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <h4 className="mb-2 text-sm font-medium">Bot Configuration</h4>
                  <div className="grid grid-cols-2 gap-4 rounded-md border p-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Asset</p>
                      <p className="font-medium">{selectedBot.asset}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Exchange</p>
                      <p className="font-medium">{selectedBot.exchange}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Frequency</p>
                      <p className="font-medium">{selectedBot.frequency}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Amount per Buy</p>
                      <p className="font-medium">{formatCurrency(selectedBot.amount)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Next Execution</p>
                      <p className="font-medium">
                        {new Date(selectedBot.nextExecution).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge variant={getStatusBadgeVariant(selectedBot.status)}>{selectedBot.status === "active" ? "Active" : "Paused"}</Badge>
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-medium">Performance Metrics</h4>
                  <div className="grid grid-cols-2 gap-4 rounded-md border p-4">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Invested</p>
                      <p className="font-medium">{formatCurrency(selectedBot.totalInvested)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Average Buy Price</p>
                      <p className="font-medium">{formatCurrency(selectedBot.averagePrice)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Current Price</p>
                      <p className="font-medium">{formatCurrency(selectedBot.averagePrice * (1 + selectedBot.profit / 100))}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Profit/Loss</p>
                      <p className={cn("font-medium", getProfitColor(selectedBot.profit))}>{formatPercentage(selectedBot.profit)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="mb-1 text-sm text-muted-foreground">Performance</p>
                      <Progress value={50 + selectedBot.profit} className="h-2" />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-medium">Purchase History</h4>
                <Table className="rounded-md border">
                  <TableHeader className=" border-b p-3 text-xs font-medium text-muted-foreground">
                   <TableRow>
                   <TableHead>Date</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Value</TableHead>
                   </TableRow>
                  </TableHeader>
                  {/* <ScrollArea className="h-[300px]"> */}
                  {selectedBot.history.map((entry, index) => (
                    <TableBody key={index} className=" border-b p-3 text-sm last:border-0">
                      <TableRow>
                      <TableCell>{entry.date}</TableCell>
                      <TableCell>{formatCurrency(entry.price)}</TableCell>
                      <TableCell>{entry.amount}</TableCell>
                      <TableCell>{formatCurrency(entry.value)}</TableCell>
                      </TableRow>
                    </TableBody>
                  ))}
                  {/* </ScrollArea> */}
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
