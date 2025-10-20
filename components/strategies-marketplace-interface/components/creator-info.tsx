"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Check, Package, Users } from "lucide-react"
import type { Creator } from "../types"
import { formatNumber } from "../utils"

interface CreatorInfoProps {
  creator: Creator
  showDetails?: boolean
}

export function CreatorInfo({ creator, showDetails = false }: CreatorInfoProps) {
  if (!showDetails) {
    return (
      <div className="flex items-center text-sm">
        <span className="font-medium">{creator.name}</span>
        {creator.verified && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Check className="ml-1 h-3 w-3 rounded-full bg-blue-500 p-[1px] text-white" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Verified Creator</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-16 w-16">
        <AvatarImage src={creator.avatar || "/placeholder.svg"} alt={creator.name} />
        <AvatarFallback>{creator.name.substring(0, 2)}</AvatarFallback>
      </Avatar>
      <div>
        <div className="flex items-center gap-1">
          <h4 className="text-lg font-semibold">{creator.name}</h4>
          {creator.verified && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Check className="h-4 w-4 rounded-full bg-blue-500 p-[2px] text-white" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Verified Creator</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Package className="h-4 w-4" />
            <span>{creator.strategies} strategies</span>
          </div>
          <div className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span>{formatNumber(creator.followers)} followers</span>
          </div>
        </div>
        <Button variant="link" size="sm" className="h-6 px-0">
          View Profile
        </Button>
      </div>
    </div>
  )
}
