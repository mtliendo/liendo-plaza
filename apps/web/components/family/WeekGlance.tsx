import type { CalendarEvent, ChoreInstance, Meal, Person } from "@liendo/shared";
import { WEEKDAY_LABELS, mealPhotoSrc, weekdayDateLabel } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";

function eventDay(iso: string) {
  return iso.slice(0, 10);
}

export function WeekGlance({
  week,
  today,
  events,
  chores,
  meals,
  people,
}: {
  week: string[];
  today: string;
  events: CalendarEvent[];
  chores: ChoreInstance[];
  meals: Meal[];
  people: Person[];
}) {
  return (
    <div className="week-glance" data-testid="week-glance">
      {week.map((iso, index) => {
        const dayEvents = events.filter((event) => eventDay(event.start) === iso);
        const dayChores = chores.filter((item) => item.date === iso);
        const meal = meals.find((row) => row.date === iso);
        const thumb = mealPhotoSrc(meal?.photoPath);
        const isToday = iso === today;
        return (
          <section key={iso} className="glance-day" data-today={isToday ? "true" : "false"}>
            <header className="glance-head">
              <h2>{isToday ? "Today" : WEEKDAY_LABELS[index]}</h2>
              <p className="small">{weekdayDateLabel(iso)}</p>
            </header>
            {dayEvents.length ? (
              <ul className="glance-list">
                {dayEvents.map((event) => (
                  <li key={`${event.uid}-${event.start}`}>{event.title}</li>
                ))}
              </ul>
            ) : (
              <p className="small">No events</p>
            )}
            <p className="glance-dinner">
              {thumb ? <img src={thumb} alt="" className="meal-thumb" /> : null}
              <span>{meal?.name ?? "Dinner not written"}</span>
            </p>
            {dayChores.length ? (
              <ul className="glance-chores">
                {dayChores.map((chore) => {
                  const person = people.find((row) => row.id === chore.personId);
                  return (
                    <li
                      key={chore.id}
                      className="glance-chore"
                      data-status={chore.status}
                      style={{ ["--person" as string]: person?.color ?? "var(--color-ink)" }}
                    >
                      {person ? <PersonAvatar person={person} size={28} /> : null}
                      <span>{chore.title}</span>
                      {chore.status === "done" ? <span className="chip">✓</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
