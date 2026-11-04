import type { ChoreInstance, Person } from "@liendo/shared";
import { mealPhotoSrc } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";

function statusLabel(status: ChoreInstance["status"]) {
  if (status === "done") return "Done";
  if (status === "pending") return "Waiting";
  if (status === "rejected") return "Try again";
  return "To do";
}

export function ChoreCard({
  chore,
  person,
  showPerson,
  onPress,
}: {
  chore: ChoreInstance;
  person?: Person;
  showPerson: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      className="chore-card"
      data-status={chore.status}
      data-testid={`chore-${chore.title}`}
      style={{ ["--person" as string]: person?.color ?? "var(--color-accent)" }}
      onClick={onPress}
    >
      {showPerson && person ? (
        <span className="name-line">
          <PersonAvatar person={person} size={48} />
          {person.name}
        </span>
      ) : null}
      {mealPhotoSrc(chore.guidePhotoPath) ? (
        <img src={mealPhotoSrc(chore.guidePhotoPath) ?? ""} alt="" className="chore-card-photo" />
      ) : null}
      <span className="chore-card-title">{chore.title}</span>
      <span className="chore-chips">
        <span className="chip" data-kind={chore.status}>
          {chore.status === "done" ? "✓ " : ""}
          {statusLabel(chore.status)}
        </span>
        {chore.requiresPhoto ? <span className="chip">Needs a photo</span> : null}
        <span className="chip">{chore.stars === 1 ? "1 star" : `${chore.stars} stars`}</span>
      </span>
    </button>
  );
}
