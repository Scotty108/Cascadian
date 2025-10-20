"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { SupportTeamMember } from "../types"
import { getStatusColor } from "../utils"

interface SupportTeamMemberProps {
  member: SupportTeamMember
}

export function SupportTeamMemberAvatar({ member }: SupportTeamMemberProps) {
  return (
    <div className="relative">
      <Avatar className="border-2 border-background">
        <AvatarImage src={member.avatar || "/placeholder.svg"} alt={member.name} />
        <AvatarFallback>
          {member.name
            .split(" ")
            .map((n) => n[0])
            .join("")}
        </AvatarFallback>
      </Avatar>
      <span
        className={cn(
          "absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-background",
          getStatusColor(member.status),
        )}
      />
    </div>
  )
}
