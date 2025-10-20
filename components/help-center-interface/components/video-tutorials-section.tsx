"use client"

import { Video, ArrowRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { VideoTutorialCard } from "./video-tutorial-card"
import { VIDEO_TUTORIALS } from "../data"

interface VideoTutorialsSectionProps {
  onVideoPlay?: (videoId: number) => void
  onViewAllClick?: () => void
}

export function VideoTutorialsSection({ onVideoPlay, onViewAllClick }: VideoTutorialsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Video className="mr-2 h-5 w-5" />
          Video Tutorials
        </CardTitle>
        <CardDescription>Learn visually with our step-by-step guides</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {VIDEO_TUTORIALS.map((video) => (
            <VideoTutorialCard key={video.id} tutorial={video} onPlay={() => onVideoPlay?.(video.id)} />
          ))}
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full" onClick={onViewAllClick}>
          View All Tutorials
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  )
}
