"use client"

import type React from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { UserProfile } from "../../types"
import { Twitter, Linkedin, Github, MessageCircle } from "lucide-react"

interface SocialProfilesProps {
  profile: UserProfile
  onProfileChange: (updates: Partial<UserProfile>) => void
}

export const SocialProfiles: React.FC<SocialProfilesProps> = ({ profile, onProfileChange }) => {
  const handleSocialChange =
    (platform: keyof UserProfile["socialProfiles"]) => (event: React.ChangeEvent<HTMLInputElement>) => {
      onProfileChange({
        socialProfiles: {
          ...profile.socialProfiles,
          [platform]: event.target.value,
        },
      })
    }

  const socialPlatforms = [
    {
      key: "twitter" as const,
      label: "Twitter",
      icon: Twitter,
      placeholder: "@username",
      prefix: "https://twitter.com/",
    },
    {
      key: "linkedin" as const,
      label: "LinkedIn",
      icon: Linkedin,
      placeholder: "username",
      prefix: "https://linkedin.com/in/",
    },
    {
      key: "github" as const,
      label: "GitHub",
      icon: Github,
      placeholder: "username",
      prefix: "https://github.com/",
    },
    {
      key: "telegram" as const,
      label: "Telegram",
      icon: MessageCircle,
      placeholder: "@username",
      prefix: "https://t.me/",
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {socialPlatforms.map((platform) => {
        const IconComponent = platform.icon
        return (
          <div key={platform.key} className="space-y-2">
            <Label htmlFor={platform.key} className="flex items-center space-x-2">
              <IconComponent className="h-4 w-4" />
              <span>{platform.label}</span>
            </Label>
            <div className="relative">
              <Input
                id={platform.key}
                value={profile.socialProfiles[platform.key]}
                onChange={handleSocialChange(platform.key)}
                placeholder={platform.placeholder}
                className="pl-3"
              />
              {profile.socialProfiles[platform.key] && (
                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <a
                    href={`${platform.prefix}${profile.socialProfiles[platform.key].replace("@", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <IconComponent className="h-4 w-4" />
                  </a>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
