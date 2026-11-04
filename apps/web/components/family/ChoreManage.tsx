import { useEffect, useState } from "react";
import type { Chore, Person } from "@liendo/shared";
import { WEEKDAY_LABELS, mealPhotoSrc, repeatLabel } from "@liendo/shared";
import { PersonAvatar } from "@/components/PersonAvatar";
import { PhotoField } from "@/components/family/PhotoField";

export type ChoreDraft = {
  title: string;
  assignedPersonId: string;
  stars: number;
  requiresPhoto: boolean;
  repeatType: Chore["repeatType"];
  weekdays: number[];
  weeklyWeekday: number | null;
  onceDate: string | null;
  description: string;
  steps: string[];
  stepDraft: string;
};

const EMPTY: ChoreDraft = {
  title: "",
  assignedPersonId: "",
  stars: 1,
  requiresPhoto: false,
  repeatType: "daily",
  weekdays: [1, 2, 3, 4, 5],
  weeklyWeekday: 0,
  onceDate: null,
  description: "",
  steps: [],
  stepDraft: "",
};

function fromChore(chore: Chore): ChoreDraft {
  return {
    title: chore.title,
    assignedPersonId: chore.assignedPersonId,
    stars: chore.stars,
    requiresPhoto: chore.requiresPhoto,
    repeatType: chore.repeatType,
    weekdays: chore.weekdays ?? (chore.repeatType === "weekdays" ? [1, 2, 3, 4, 5] : chore.weeklyWeekday != null ? [chore.weeklyWeekday] : []),
    weeklyWeekday: chore.weeklyWeekday,
    onceDate: chore.onceDate,
    description: chore.description ?? "",
    steps: chore.steps ?? [],
    stepDraft: "",
  };
}

function payload(draft: ChoreDraft) {
  const weekdays =
    draft.repeatType === "weekdays"
      ? [1, 2, 3, 4, 5]
      : draft.repeatType === "weekly"
        ? draft.weekdays
        : null;
  return {
    title: draft.title,
    assignedPersonId: draft.assignedPersonId,
    stars: draft.stars,
    requiresPhoto: draft.requiresPhoto,
    repeatType: draft.repeatType,
    weekdays,
    weeklyWeekday: draft.repeatType === "weekly" ? (draft.weekdays[0] ?? 0) : null,
    onceDate: draft.repeatType === "once" ? draft.onceDate : null,
    description: draft.description.trim() || null,
    steps: draft.steps,
  };
}

export function ChoreManage({
  people,
  chores,
  onCreate,
  onUpdate,
  onDelete,
  onGuidePhoto,
  onClearGuide,
}: {
  people: Person[];
  chores: Chore[];
  onCreate: (body: Record<string, unknown>) => Promise<string | void>;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onGuidePhoto: (id: string, file: File) => Promise<void>;
  onClearGuide: (id: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChoreDraft>(EMPTY);
  const [error, setError] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!draft.assignedPersonId && people[0]) {
      setDraft((current) => ({ ...current, assignedPersonId: people[0].id }));
    }
  }, [draft.assignedPersonId, people]);

  function startNew() {
    setEditingId(null);
    setDraft({ ...EMPTY, assignedPersonId: people[0]?.id ?? "" });
    setError("");
    setPendingPhoto(null);
    setPendingSrc(null);
  }

  function stagePhoto(file: File) {
    setPendingPhoto(file);
    setPendingSrc(URL.createObjectURL(file));
  }

  async function save() {
    if (!draft.title.trim() || !draft.assignedPersonId) {
      setError("Give it a name and a kid.");
      return;
    }
    if (draft.repeatType === "weekly" && draft.weekdays.length === 0) {
      setError("Pick at least one day.");
      return;
    }
    if (draft.repeatType === "once" && !draft.onceDate) {
      setError("Pick the day this happens.");
      return;
    }
    setError("");
    const body = payload(draft);
    if (editingId) {
      await onUpdate(editingId, body);
      if (pendingPhoto) await onGuidePhoto(editingId, pendingPhoto);
    } else {
      const id = await onCreate(body);
      if (id && pendingPhoto) await onGuidePhoto(id, pendingPhoto);
    }
    startNew();
  }

  function addStep() {
    const next = draft.stepDraft.trim();
    if (!next) return;
    setDraft({ ...draft, steps: [...draft.steps, next], stepDraft: "" });
  }

  const active = chores.filter((chore) => chore.active);

  return (
    <div className="chore-manage" data-testid="chore-manage">
      <form
        className="list"
        onSubmit={async (event) => {
          event.preventDefault();
          await save();
        }}
      >
        <label className="field">
          <span>Chore</span>
          <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
        </label>
        <label className="field">
          <span>Who</span>
          <select
            className="select"
            value={draft.assignedPersonId}
            onChange={(e) => setDraft({ ...draft, assignedPersonId: e.target.value })}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Stars</span>
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            value={draft.stars}
            onChange={(e) => setDraft({ ...draft, stars: Number(e.target.value) })}
          />
        </label>
        <label className="field field-check">
          <span>Needs a photo</span>
          <input
            type="checkbox"
            checked={draft.requiresPhoto}
            onChange={(e) => setDraft({ ...draft, requiresPhoto: e.target.checked })}
          />
        </label>
        <label className="field">
          <span>Repeat</span>
          <select
            className="select"
            value={draft.repeatType}
            onChange={(e) => setDraft({ ...draft, repeatType: e.target.value as Chore["repeatType"] })}
          >
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">On chosen days</option>
            <option value="once">Once</option>
          </select>
        </label>
        {draft.repeatType === "weekly" ? (
          <fieldset className="day-picks">
            <legend>Days</legend>
            {WEEKDAY_LABELS.map((label, index) => (
              <label key={label} className="field-check">
                <input
                  type="checkbox"
                  checked={draft.weekdays.includes(index)}
                  onChange={() => {
                    const next = draft.weekdays.includes(index)
                      ? draft.weekdays.filter((day) => day !== index)
                      : [...draft.weekdays, index].sort((a, b) => a - b);
                    setDraft({ ...draft, weekdays: next, weeklyWeekday: next[0] ?? 0 });
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
        ) : null}
        <label className="field">
          <span>How to do it</span>
          <textarea
            className="input"
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="A sentence the kids can read from the kitchen."
          />
        </label>
        <div className="field">
          <span>Steps</span>
          <ul className="chore-step-edit">
            {draft.steps.map((step, index) => (
              <li key={`${step}-${index}`}>
                <span>{step}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, item) => item !== index) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="chore-step-add">
            <input
              className="input"
              value={draft.stepDraft}
              placeholder="Add a step"
              onChange={(e) => setDraft({ ...draft, stepDraft: e.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addStep();
                }
              }}
            />
            <button type="button" className="btn-secondary" onClick={addStep}>
              Add step
            </button>
          </div>
        </div>
        <PhotoField
          src={
            pendingSrc ??
            (editingId ? mealPhotoSrc(chores.find((chore) => chore.id === editingId)?.guidePhotoPath) : null)
          }
          label="Photo"
          onPick={(file) => {
            if (editingId) void onGuidePhoto(editingId, file);
            else stagePhoto(file);
          }}
          onClear={
            pendingSrc || (editingId && chores.find((chore) => chore.id === editingId)?.guidePhotoPath)
              ? () => {
                  setPendingPhoto(null);
                  setPendingSrc(null);
                  if (editingId) void onClearGuide(editingId);
                }
              : undefined
          }
        />
        {draft.repeatType === "once" ? (
          <label className="field">
            <span>Date</span>
            <input
              className="input"
              type="date"
              value={draft.onceDate ?? ""}
              onChange={(e) => setDraft({ ...draft, onceDate: e.target.value || null })}
            />
          </label>
        ) : null}
        {error ? <p style={{ color: "var(--color-error)" }}>{error}</p> : null}
        <button className="btn" type="submit">
          {editingId ? "Save chore" : "Add chore"}
        </button>
        {editingId ? (
          <button type="button" className="btn-secondary" onClick={startNew}>
            Cancel
          </button>
        ) : null}
      </form>
      <div className="list">
        {active.map((chore) => {
          const person = people.find((row) => row.id === chore.assignedPersonId);
          return (
            <article
              key={chore.id}
              className="chore-manage-row"
              style={{ ["--person" as string]: person?.color ?? "var(--color-ink)" }}
            >
              <div className="name-line">
                {person ? <PersonAvatar person={person} size={40} /> : null}
                {chore.guidePhotoPath ? (
                  <img src={mealPhotoSrc(chore.guidePhotoPath) ?? ""} alt="" className="chore-guide-thumb" />
                ) : null}
                <div>
                  <p>{chore.title}</p>
                  <p className="small">
                    {person?.name} · {repeatLabel(chore)} · {chore.stars === 1 ? "1 star" : `${chore.stars} stars`}
                    {chore.requiresPhoto ? " · photo" : ""}
                  </p>
                </div>
              </div>
              <div className="chore-manage-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEditingId(chore.id);
                    setDraft(fromChore(chore));
                    setPendingPhoto(null);
                    setPendingSrc(null);
                  }}
                >
                  Edit
                </button>
                <button type="button" className="btn-secondary" onClick={() => void onDelete(chore.id)}>
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
