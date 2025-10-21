import { EventDetail } from "@/components/event-detail";

export const metadata = {
  title: "Event Detail | CASCADIAN",
  description: "Explore all markets within this prediction event",
};

interface EventPageProps {
  params: {
    slug: string;
  };
}

export default function EventPage({ params }: EventPageProps) {
  return <EventDetail eventSlug={params.slug} />;
}
