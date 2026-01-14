import { EventPageV3 } from "@/components/event-page-v3";

export const metadata = {
  title: "Event Detail | CASCADIAN",
  description: "Explore all markets within this prediction event with smart money insights",
};

interface EventPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function EventPage({ params }: EventPageProps) {
  const { slug } = await params;
  return <EventPageV3 eventSlug={slug} />;
}
