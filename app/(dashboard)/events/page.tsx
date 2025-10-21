import { EventsOverview } from "@/components/events-overview";

export const metadata = {
  title: "Events | CASCADIAN",
  description: "Browse prediction markets grouped by major events",
};

export default function EventsPage() {
  return <EventsOverview />;
}
