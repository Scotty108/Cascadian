import { Check } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface CreatorBadgeProps {
  creator: {
    name: string
    avatar: string
    verified: boolean
  }
  size?: "sm" | "md" | "lg"
}

export function CreatorBadge({ creator, size = "sm" }: CreatorBadgeProps) {
  const sizeClasses = {
    sm: { avatar: "h-5 w-5", text: "text-xs", icon: "h-3 w-3" },
    md: { avatar: "h-6 w-6", text: "text-sm", icon: "h-4 w-4" },
    lg: { avatar: "h-8 w-8", text: "text-base", icon: "h-5 w-5" },
  }

  return (
    <div className="flex items-center gap-1">
      <Avatar className={sizeClasses[size].avatar}>
        <AvatarImage src={creator.avatar || "/placeholder.svg"} />
        <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
      </Avatar>
      <span className={sizeClasses[size].text}>{creator.name}</span>
      {creator.verified && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Check className={`${sizeClasses[size].icon} text-blue-500`} />
            </TooltipTrigger>
            <TooltipContent>Verified Creator</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  )
}
