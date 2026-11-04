export function PhotoField({
  src,
  label = "Photo",
  onPick,
  onClear,
}: {
  src: string | null;
  label?: string;
  onPick: (file: File) => void;
  onClear?: () => void;
}) {
  return (
    <div className="photo-field" data-testid="photo-field">
      <span>{label}</span>
      {src ? <img src={src} alt="" className="photo-field-image" /> : null}
      <label className="btn-secondary">
        {src ? "Replace photo" : "Add a photo"}
        <input
          type="file"
          accept="image/*"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPick(file);
            event.target.value = "";
          }}
        />
      </label>
      {src && onClear ? (
        <button type="button" className="btn-secondary" onClick={onClear}>
          Remove photo
        </button>
      ) : null}
    </div>
  );
}
