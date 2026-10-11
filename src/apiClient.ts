import { supabase } from "./supabase";

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** GET a coins/admin endpoint, attaching the caller's Supabase access token as a header. */
export async function apiGet(path: string, extraParams: Record<string, string> = {}): Promise<any> {
  const token = await accessToken();
  const params = new URLSearchParams(extraParams);
  const sep = path.includes("?") ? "&" : "?";
  const query = params.toString();
  const res = await fetch(`${path}${query ? `${sep}${query}` : ""}`, {
    headers: token ? { "x-access-token": token } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
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
  return data;
}
