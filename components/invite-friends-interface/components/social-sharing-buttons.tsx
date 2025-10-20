"use client"

import { Button } from "@/components/ui/button"
import { SOCIAL_PLATFORMS } from "../constants"
import { useSharing } from "../hooks/use-sharing"

interface SocialSharingButtonsProps {
  url: string
  message: string
}

export function SocialSharingButtons({ url, message }: SocialSharingButtonsProps) {
  const { shareOnSocial } = useSharing()

  return (
    <div className="flex flex-wrap gap-2">
      {SOCIAL_PLATFORMS.map((platform) => {
        const Icon = platform.icon
        return (
          <Button
            key={platform.name}
            variant="outline"
            size="sm"
            className="flex items-center gap-1"
            onClick={() => shareOnSocial(platform.name, url, message)}
          >
            <Icon className={`h-4 w-4 ${platform.color}`} />
            {platform.name}
          </Button>
        )
      })}
    </div>
  )
}
