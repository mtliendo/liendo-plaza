import { API_URL } from "./config";
import { getSession } from "./session";
import { mealPhotoSrc } from "@liendo/shared";

export function photoUri(path: string | null | undefined): string | null {
  const src = mealPhotoSrc(path);
  if (!src) return null;
  return src.startsWith("http") ? src : `${API_URL}${src}`;
}

export async function uploadPhoto(path: string, uri: string) {
  const token = await getSession();
  const form = new FormData();
  form.append("photo", {
    uri,
    name: "photo.jpg",
    type: "image/jpeg",
  } as never);
  const res = await fetch(`${API_URL}/api/${path}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error ?? "Could not save that photo.");
  return data;
}

export async function api(path: string, init: RequestInit = {}) {
  const token = await getSession();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(`${API_URL}/api/${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}
