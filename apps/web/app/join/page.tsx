"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function JoinRedirect() {
  const params = useSearchParams();
  const router = useRouter();
  const invite = params.get("invite") ?? params.get("code") ?? "";

  useEffect(() => {
    router.replace(invite ? `/family?invite=${encodeURIComponent(invite)}` : "/family");
  }, [invite, router]);

  return (
    <main className="phone">
      <h1>Opening Liendo Plaza</h1>
      <p>This invite opens the family app. Pick your name and PIN next.</p>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinRedirect />
    </Suspense>
  );
}
