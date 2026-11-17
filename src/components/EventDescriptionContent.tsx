import { renderEventDescriptionHtml } from "../lib/eventDescriptionHtml";

export function EventDescriptionContent({ description }: { description: string }) {
  return <div className="event-description-content" dangerouslySetInnerHTML={{ __html: renderEventDescriptionHtml(description) }} />;
}
