"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Search, Plus, Star, StarOff, Bell, BellOff, MessageSquare, ExternalLink, Sparkles } from "lucide-react"
import type { SignalProvider } from "../types"

interface ProvidersTabProps {
  providers: SignalProvider[]
  onAddProvider: () => void
  onToggleFavorite: (providerId: string) => void
  onToggleStatus: (providerId: string) => void
  onViewDetails: (providerId: string) => void
}

export function ProvidersTab({
  providers,
  onAddProvider,
  onToggleFavorite,
  onToggleStatus,
  onViewDetails,
}: ProvidersTabProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
  }

  const filteredProviders = providers.filter(
    (provider) =>
      provider.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      provider.description.toLowerCase().includes(searchQuery.toLowerCase()),
  )
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col flex-wrap gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Signal Providers</CardTitle>
              <CardDescription>Manage your signal providers and subscriptions</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-full sm:w-auto">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search providers..."
                  className="w-full pl-8 sm:w-[200px]"
                  value={searchQuery}
                  onChange={handleSearchChange}
                />
              </div>
              <Button onClick={onAddProvider}>
                <Plus className="mr-1 h-4 w-4" />
                <span>Add Provider</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredProviders.map((provider) => (
              <Card key={provider.id}>
                <CardContent className="p-0">
                  <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={provider.avatar || "/placeholder.svg"} alt={provider.name} />
                        <AvatarFallback>{provider.name.substring(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center flex-wrap gap-2">
                          <h4 className="font-medium">{provider.name}</h4>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              provider.status === "active"
                                ? "border-green-200 bg-green-100 text-green-700 dark:border-green-900 dark:bg-green-900/30 dark:text-green-400"
                                : "border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-900/30 dark:text-red-400",
                            )}
                          >
                            {provider.status === "active" ? "Active" : "Inactive"}
                          </Badge>
                          {provider.favorite && (
                            <Badge
                              variant="outline"
                              className="border-yellow-200 bg-yellow-100 text-yellow-700 dark:border-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-400"
                            >
                              Favorite
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{provider.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-semibold">{provider.accuracy}%</span>
                        <span className="text-xs text-muted-foreground">Accuracy</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-semibold">{provider.signals}</span>
                        <span className="text-xs text-muted-foreground">Signals</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-semibold">{provider.subscribers.toLocaleString()}</span>
                        <span className="text-xs text-muted-foreground">Subscribers</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-lg font-semibold">{provider.price}</span>
                        <span className="text-xs text-muted-foreground">Price</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap justify-between border-t bg-muted/30 px-4 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => onToggleFavorite(provider.id)}>
                        {provider.favorite ? (
                          <>
                            <StarOff className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                            <span>Remove Favorite</span>
                          </>
                        ) : (
                          <>
                            <Star className="h-3.5 w-3.5" />
                            <span>Add to Favorites</span>
                          </>
                        )}
                      </Button>
                      <Separator orientation="vertical" className="h-4" />
                      <Button variant="ghost" size="sm" className="gap-1" onClick={() => onToggleStatus(provider.id)}>
                        {provider.status === "active" ? (
                          <>
                            <BellOff className="h-3.5 w-3.5" />
                            <span>Mute</span>
                          </>
                        ) : (
                          <>
                            <Bell className="h-3.5 w-3.5" />
                            <span>Unmute</span>
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm">
                        <MessageSquare className="mr-1 h-3.5 w-3.5" />
                        <span>Contact</span>
                      </Button>
                      <Button variant="default" size="sm" onClick={() => onViewDetails(provider.id)}>
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        <span>View Details</span>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discover New Providers</CardTitle>
          <CardDescription>Find and add new signal providers to your list</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[200px] items-center justify-center rounded-md border-2 border-dashed">
            <div className="text-center">
              <Sparkles className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-2 text-lg font-medium">Explore Signal Providers</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Discover top-performing signal providers for your trading strategy
              </p>
              <Button className="mt-4">Browse Marketplace</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
