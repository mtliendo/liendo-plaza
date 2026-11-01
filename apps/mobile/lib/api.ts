import { API_URL } from "./config";
import { getSession } from "./session";

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
