"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function JoinForm() {
  const params = useSearchParams();
  const [secret, setSecret] = useState(params.get("code") ?? "");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const res = await fetch("/api/auth/family", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    setMessage(res.ok ? "Code accepted. Open the phone app or /family next." : "That code did not work.");
  }

  return (
    <main className="phone">
      <h1>Join Liendo Plaza</h1>
      <form onSubmit={submit} className="list">
        <label className="field">
          <span>Family code</span>
          <input className="input" value={secret} onChange={(e) => setSecret(e.target.value)} />
        </label>
        <button className="btn" type="submit">
          Save the code
        </button>
        {message ? <p>{message}</p> : null}
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
