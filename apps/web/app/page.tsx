import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container" style={{ paddingBlock: "var(--space-3xl)" }}>
      <p className="small">Davenport</p>
      <h1>Liendo Plaza</h1>
      <p className="lead" style={{ marginTop: "var(--space-md)" }}>
        The kitchen board and the phones share one list: today, chores, stars, and dinner.
      </p>
      <div style={{ display: "flex", gap: "var(--space-lg)", marginTop: "var(--space-xl)" }}>
        <Link className="btn" href="/display">
          Open the kitchen board
        </Link>
        <Link className="btn-secondary btn" href="/family">
          Open on a phone
        </Link>
      </div>
    </main>
  );
}
