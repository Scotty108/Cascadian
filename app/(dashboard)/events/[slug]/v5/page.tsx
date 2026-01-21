import { EventPageV5 } from "@/components/event-page-v5";

export const metadata = {
  title: "Event Detail V5 | CASCADIAN",
  description: "Premium market view with Fey-inspired dark theme design",
};

interface EventPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function EventPageV5Route({ params }: EventPageProps) {
  const { slug } = await params;
  return <EventPageV5 eventSlug={slug} />;
}
