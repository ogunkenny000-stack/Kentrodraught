import { supabase } from "./supabase";

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

// Share only concurrent reads. Never cache responses or merge writes.
// Including the access token prevents one account from joining another's request.
const pendingReads = new Map<string, Promise<any>>();
const READ_TIMEOUT_MS = 15_000;

export async function apiGet(path: string, extraParams: Record<string, string> = {}): Promise<any> {
  const token = await accessToken();
  const params = new URLSearchParams(extraParams);
  params.sort();
  const query = params.toString();
  const url = `${path}${query ? `${path.includes("?") ? "&" : "?"}${query}` : ""}`;
  const key = JSON.stringify([token, url]);
  const pending = pendingReads.get(key);
  if (pending) return pending;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  const request = (async () => {
    try {
      const res = await fetch(url, {
        headers: token ? { "x-access-token": token } : {},
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (controller.signal.aborted) throw new Error("Request timed out. Please retry.");
      if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw Object.assign(new Error("Request timed out. Please retry."), { status: 408 });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();
  pendingReads.set(key, request);
  try { return await request; }
  finally { if (pendingReads.get(key) === request) pendingReads.delete(key); }
}

/** POST a coins/admin endpoint, attaching the caller's Supabase access token as a header. */
export async function apiPost(path: string, body: Record<string, any> = {}): Promise<any> {
  const token = await accessToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-access-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  pendingReads.clear();
  return data;
}
