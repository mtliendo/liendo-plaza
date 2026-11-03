import type { ChoreInstance, Person } from "@liendo/shared";
import { mealPhotoSrc, repeatLabel } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";

function statusCopy(status: ChoreInstance["status"]) {
  if (status === "done") return "Done today";
  if (status === "pending") return "Waiting on a parent";
  if (status === "rejected") return "Try again";
  return "Still open";
}

export function ChoreDetail({
  chore,
  person,
  large,
  canAct,
  onClose,
  onComplete,
  onUndo,
  onPhoto,
}: {
  chore: ChoreInstance;
  person?: Person;
  large?: boolean;
  canAct: boolean;
  onClose: () => void;
  onComplete: () => void;
  onUndo: () => void;
  onPhoto?: (file: File) => void;
}) {
  const guide = mealPhotoSrc(chore.guidePhotoPath);
  const proof = mealPhotoSrc(chore.photoPath);
  const open = chore.status === "open" || chore.status === "rejected";
  return (
    <div className="chore-detail-back" data-testid="chore-detail" onClick={onClose}>
      <article
        className={`chore-detail${large ? " chore-detail-large" : ""}`}
        style={{ ["--person" as string]: person?.color ?? "var(--color-ink)" }}
        onClick={(event) => event.stopPropagation()}
      >
        {person ? (
          <p className="name-line">
            <PersonAvatar person={person} size={large ? 96 : 56} />
            {person.name}
          </p>
        ) : null}
        <h2>{chore.title}</h2>
        <p className="chore-detail-meta">
          {statusCopy(chore.status)}
          {" · "}
          {chore.stars === 1 ? "1 star" : `${chore.stars} stars`}
          {" · "}
          {repeatLabel(chore)}
          {chore.requiresPhoto ? " · Needs a photo" : ""}
        </p>
        {chore.description ? <p className="chore-detail-copy">{chore.description}</p> : null}
        {guide ? <img src={guide} alt="" className="chore-guide-photo" /> : null}
        {chore.steps.length ? (
          <ol className="chore-steps">
            {chore.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : null}
        {proof ? <img src={proof} alt="" className="chore-guide-photo" /> : null}
        <div className="chore-detail-actions">
          {canAct && open && !chore.requiresPhoto ? (
            <button type="button" className="btn" onClick={onComplete}>
              Mark done
            </button>
          ) : null}
          {canAct && open && chore.requiresPhoto && onPhoto ? (
            <label className="btn">
              Take a photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onPhoto(file);
                }}
              />
            </label>
          ) : null}
          {canAct && open && chore.requiresPhoto && !onPhoto ? (
            <p className="small">Take the photo on a phone.</p>
          ) : null}
          {canAct && chore.status === "done" ? (
            <button type="button" className="btn-secondary" onClick={onUndo}>
              Not done
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </article>
    </div>
  );
}
