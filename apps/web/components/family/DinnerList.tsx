import { useState } from "react";
import type { Meal } from "@liendo/shared";
import { mealPhotoSrc, weekdayDateLabel } from "@liendo/shared";

export function DinnerList({
  week,
  today,
  meals,
  isParent,
  suggestions,
  onSuggest,
  onSave,
}: {
  week: string[];
  today: string;
  meals: Meal[];
  isParent: boolean;
  suggestions: string[];
  onSuggest: () => void;
  onSave: (date: string, name: string) => void;
}) {
  return (
    <div className="dinner-list" data-testid="dinner-list">
      {week.map((iso) => {
        const meal = meals.find((row) => row.date === iso);
        const thumb = mealPhotoSrc(meal?.photoPath);
        const isTonight = iso === today;
        return (
          <article key={iso} className="dinner-row" data-tonight={isTonight ? "true" : "false"}>
            <div className="dinner-when">
              {isTonight ? <p className="place">Tonight</p> : null}
              <p className="day-name">{weekdayDateLabel(iso)}</p>
            </div>
            <div className="dinner-what">
              {thumb ? <img src={thumb} alt="" className="meal-thumb" /> : null}
              {isParent ? (
                <DinnerEditor date={iso} name={meal?.name ?? ""} onSuggest={onSuggest} onSave={onSave} />
              ) : (
                <p className="dinner-name">{meal?.name ?? "Not written yet"}</p>
              )}
            </div>
          </article>
        );
      })}
      {isParent ? (
        <datalist id="meal-names">
          {suggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

function DinnerEditor({
  date,
  name,
  onSuggest,
  onSave,
}: {
  date: string;
  name: string;
  onSuggest: () => void;
  onSave: (date: string, name: string) => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <div className="dinner-edit">
      <input
        className="input"
        value={value}
        list="meal-names"
        placeholder="What’s for dinner?"
        aria-label={`Dinner for ${date}`}
        onFocus={() => onSuggest()}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => onSave(date, value)}
      />
      {value ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setValue("");
            onSave(date, "");
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
