"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Search,
  Filter,
  MoreHorizontal,
  Play,
  Pause,
  Edit,
  Copy,
  Trash2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react"
import type { DcaBot } from "../types"
import { formatCurrency, formatPercentage, formatDateTime, getProfitColor } from "../utils"

interface BotsTabProps {
  bots: DcaBot[]
  onEditBot: (bot: DcaBot) => void
  onToggleStatus: (botId: string) => void
  onCopyBot: (botId: string) => void
  onDeleteBot: (botId: string) => void
}

export function BotsTab({ bots, onEditBot, onToggleStatus, onCopyBot, onDeleteBot }: BotsTabProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<string>("created")

  const filteredBots = bots
    .filter((bot) => {
      const matchesSearch =
        bot.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        bot.asset.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === "all" || bot.status === statusFilter
      return matchesSearch && matchesStatus
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name)
        case "profit":
          return b.profit - a.profit
        case "invested":
          return b.totalInvested - a.totalInvested
        case "created":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
    })

  const handleDeleteBot = (bot: DcaBot) => {
    if (confirm(`Are you sure you want to delete "${bot.name}"? This action cannot be undone.`)) {
      onDeleteBot(bot.id)
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filter & Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search bots by name or asset..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="created">Date Created</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="profit">Profit</SelectItem>
                <SelectItem value="invested">Total Invested</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      {searchTerm || statusFilter !== "all" ? (
        <Alert>
          <AlertDescription>
            Showing {filteredBots.length} of {bots.length} bots
            {searchTerm && ` matching "${searchTerm}"`}
            {statusFilter !== "all" && ` with status "${statusFilter}"`}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Bots Grid */}
      {filteredBots.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <div className="text-muted-foreground">
              {searchTerm || statusFilter !== "all" ? (
                <>
                  <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No bots match your search criteria</p>
                  <p className="text-sm mt-2">Try adjusting your filters or search terms</p>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No DCA bots created yet</p>
                  <p className="text-sm mt-2">Create your first bot to get started</p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredBots.map((bot) => (
            <Card key={bot.id} className="relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{bot.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={bot.status === "active" ? "default" : "outline"}>
                        {bot.status === "active" ? (
                          <CheckCircle className="h-3 w-3 mr-1" />
                        ) : (
                          <Pause className="h-3 w-3 mr-1" />
                        )}
                        {bot.status}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{bot.asset}</span>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onToggleStatus(bot.id)}>
                        {bot.status === "active" ? (
                          <>
                            <Pause className="h-4 w-4 mr-2" />
                            Pause Bot
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4 mr-2" />
                            Start Bot
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEditBot(bot)}>
                        <Edit className="h-4 w-4 mr-2" />
                        Edit Bot
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCopyBot(bot.id)}>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Bot
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDeleteBot(bot)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Bot
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Invested</p>
                    <p className="font-semibold">{formatCurrency(bot.totalInvested)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Current Profit</p>
                    <p className={`font-semibold ${getProfitColor(bot.profit)}`}>{formatCurrency(bot.profit)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg. Price</p>
                    <p className="font-semibold">{formatCurrency(bot.averagePrice)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">ROI</p>
                    <p className={`font-semibold ${getProfitColor(bot.profit)}`}>
                      {bot.totalInvested > 0 ? formatPercentage((bot.profit / bot.totalInvested) * 100) : "0%"}
                    </p>
                  </div>
                </div>

                {/* Bot Details */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Exchange:</span>
                    <span>{bot.exchange}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Frequency:</span>
                    <span>{bot.frequency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount:</span>
                    <span>{formatCurrency(bot.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Next Run:</span>
                    <span>{formatDateTime(bot.nextExecution)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Purchases:</span>
                    <span>{bot.history.length}</span>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => onToggleStatus(bot.id)}>
                    {bot.status === "active" ? (
                      <>
                        <Pause className="h-3 w-3 mr-1" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 mr-1" />
                        Start
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => onEditBot(bot)}>
                    <Edit className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
