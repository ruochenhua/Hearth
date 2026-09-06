export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请重试";

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("X-MyMoment", "1");
  const response = await fetch("/api" + url, { ...options, headers });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401 && url !== "/login")
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(body.error || "请求失败");
  }
  return body;
}
