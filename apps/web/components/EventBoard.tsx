import Link from "next/link";
import { nextUpcomingLabel, planTodayEvents, type CalendarEvent, type Person } from "@liendo/shared";

export function EventBoard({
  events,
  now,
  people,
  maxVisible,
  moreHref,
  heading,
  className = "",
}: {
  events: CalendarEvent[];
  now: string;
  people: Person[];
  maxVisible: number;
  moreHref: string;
  heading?: string;
  className?: string;
}) {
  const plan = planTodayEvents(events, now, people, maxVisible);
  const empty = plan.today.length === 0;

  return (
    <section
      className={`events ${className}`.trim()}
      data-testid="events"
      data-count={empty ? "0" : plan.today.length >= 6 ? "many" : "few"}
    >
      {heading ? <h2>{heading}</h2> : null}
      {empty ? (
        <div className="events-empty-block">
          <p className="events-empty">Nothing on the calendar today</p>
          {plan.next ? <p className="events-next">{nextUpcomingLabel(plan.next)}</p> : null}
        </div>
      ) : (
        <div className="event-list">
          {plan.visible.map((item) => (
            <article
              key={`${item.event.uid}-${item.event.start}`}
              className="event-row"
              data-phase={item.phase}
              data-all-day={item.event.allDay ? "true" : "false"}
              style={item.color ? { ["--person" as string]: item.color } : undefined}
            >
              <span className="event-time num">{item.timeLabel}</span>
              <span className="event-title">{item.event.title}</span>
            </article>
          ))}
          {plan.moreCount > 0 ? (
            <Link href={moreHref} className="events-more tap" data-testid="events-more">
              +{plan.moreCount} more
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}
