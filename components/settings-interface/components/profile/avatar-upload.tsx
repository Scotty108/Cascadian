"use client"

import type React from "react"
import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Upload, Camera, Trash2 } from "lucide-react"
import { toast } from "sonner"

interface AvatarUploadProps {
  currentAvatar: string
  userName: string
  onAvatarChange: (avatar: string) => void
}

export const AvatarUpload: React.FC<AvatarUploadProps> = ({ currentAvatar, userName, onAvatarChange }) => {
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file")
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size must be less than 5MB")
      return
    }

    setIsUploading(true)
    try {
      // Simulate upload
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Create object URL for preview
      const imageUrl = URL.createObjectURL(file)
      onAvatarChange(imageUrl)

      toast.success("Avatar updated successfully")
    } catch (error) {
      toast.error("Failed to upload avatar")
    } finally {
      setIsUploading(false)
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveAvatar = () => {
    onAvatarChange("/placeholder.svg?height=100&width=100")
    toast.success("Avatar removed")
  }

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="flex items-center space-x-4">
      <Avatar className="h-20 w-20">
        <AvatarImage src={currentAvatar || "/placeholder.svg"} alt={userName} />
        <AvatarFallback className="text-lg">{getInitials(userName)}</AvatarFallback>
      </Avatar>

      <div className="space-y-2">
        <div className="flex space-x-2">
          <Button variant="outline" size="sm" onClick={handleUploadClick} disabled={isUploading}>
            {isUploading ? (
              <>
                <Upload className="mr-2 h-4 w-4 animate-pulse" />
                Uploading...
              </>
            ) : (
              <>
                <Camera className="mr-2 h-4 w-4" />
                Change
              </>
            )}
          </Button>

          <Button variant="outline" size="sm" onClick={handleRemoveAvatar} disabled={isUploading}>
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">JPG, PNG or GIF. Max size 5MB.</p>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
    </div>
  )
}
