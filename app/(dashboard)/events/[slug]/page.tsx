import { EventDetail } from "@/components/event-detail";

export const metadata = {
  title: "Event Detail | CASCADIAN",
  description: "Explore all markets within this prediction event",
};

interface EventPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function EventPage({ params }: EventPageProps) {
  const { slug } = await params;
  return <EventDetail eventSlug={slug} />;
}
