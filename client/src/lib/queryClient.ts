import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Turn an apiRequest/query error (whose message looks like
 * `422: {"error":"...","blockers":[...],"code":"..."}`) into a
 * human-readable message. Falls back to the raw message when it
 * isn't in that shape.
 */
export function friendlyApiError(err: unknown, fallback = "Something went wrong"): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (!raw) return fallback;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(raw.slice(jsonStart));
      const parts: string[] = [];
      const main = body.error || body.message;
      if (typeof main === "string" && main) parts.push(main);
      if (Array.isArray(body.blockers) && body.blockers.length > 0) {
        parts.push(body.blockers.join(" "));
      }
      if (parts.length > 0) return parts.join(" — ");
    } catch {
      // not JSON — fall through to raw message
    }
  }
  // Strip a leading "NNN: " status prefix if present.
  return raw.replace(/^\d{3}:\s*/, "") || fallback;
}

/** Extract the machine `code` field from an API error body, if any. */
export function apiErrorCode(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const body = JSON.parse(raw.slice(jsonStart));
    if (typeof body.code === "string") return body.code;
    return typeof body.error?.code === "string" ? body.error.code : null;
  } catch {
    return null;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
