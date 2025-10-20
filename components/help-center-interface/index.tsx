"use client"

import { SearchSection } from "./components/search-section"
import { CategoryFilters } from "./components/category-filters"
import { PopularArticlesSection } from "./components/popular-articles-section"
import { FAQSection } from "./components/faq-section"
import { VideoTutorialsSection } from "./components/video-tutorials-section"
import { ContactSupportSection } from "./components/contact-support-section"
import { ResourcesSection } from "./components/resources-section"
import { PlatformStatusSection } from "./components/platform-status-section"
import { useHelpCenter } from "./hooks/use-help-center"
import { useSupport } from "./hooks/use-support"

export function HelpCenterInterface() {
  const { searchQuery, selectedCategory, filteredArticles, setSearchQuery, setSelectedCategory } = useHelpCenter()

  const { startLiveChat, openContactModal } = useSupport()

  const handleArticleClick = (article: any) => {
    console.log("Opening article:", article.title)
    // Implement article navigation
  }

  const handleVideoPlay = (videoId: number) => {
    console.log("Playing video:", videoId)
    // Implement video player
  }

  const handleResourceClick = (resourceTitle: string) => {
    console.log("Opening resource:", resourceTitle)
    // Implement resource navigation
  }

  const handleStatusPageClick = () => {
    console.log("Opening status page")
    // Implement status page navigation
  }

  return (
    <div className=" space-y-8 pb-10">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Help Center</h1>
        <p className="text-muted-foreground">Find answers, tutorials, and support for all your DefibotX needs</p>
      </div>

      {/* Search and Quick Actions */}
      <SearchSection onSearch={setSearchQuery} onContactSupport={openContactModal} onLiveChat={startLiveChat} />

      {/* Categories */}
      <CategoryFilters selectedCategory={selectedCategory} onCategoryChange={setSelectedCategory} />

      {/* Main Content */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column - Articles and FAQs */}
        <div className="lg:col-span-2  space-y-8">
          <PopularArticlesSection
            articles={filteredArticles}
            onArticleClick={handleArticleClick}
            onViewAllClick={() => console.log("View all articles")}
          />

          <FAQSection onViewAllClick={() => console.log("View all FAQs")} />
        </div>

        {/* Right Column - Video Tutorials, Support, Resources */}
        <div className=" lg:col-span-1 space-y-8">
          <VideoTutorialsSection
            onVideoPlay={handleVideoPlay}
            onViewAllClick={() => console.log("View all tutorials")}
          />

          <ContactSupportSection onLiveChatClick={startLiveChat} onEmailClick={openContactModal} />

          <ResourcesSection onResourceClick={handleResourceClick} />
        </div>
      </div>

      {/* Status and Updates */}
      <PlatformStatusSection onStatusPageClick={handleStatusPageClick} />
    </div>
  )
}
