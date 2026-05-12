type GeoInfo = {
  country: string | null;
  region: string | null;
  city: string | null;
};

const NULL_GEO: GeoInfo = { country: null, region: null, city: null };

const cache = new Map<string, { value: GeoInfo; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1500;

function isPrivateIp(ip: string): boolean {
  if (!ip || ip === "unknown" || ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1] || "0", 10);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
  return false;
}

export async function lookupGeo(ip: string): Promise<GeoInfo> {
  if (isPrivateIp(ip)) return NULL_GEO;

  const hit = cache.get(ip);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`,
      { signal: ctrl.signal },
    );
    clearTimeout(timer);

    if (!res.ok) {
      cache.set(ip, { value: NULL_GEO, expiresAt: Date.now() + NEGATIVE_TTL_MS });
      return NULL_GEO;
    }
    const data = (await res.json()) as {
      status?: string;
      country?: string;
      regionName?: string;
      city?: string;
    };
    if (data.status !== "success") {
      cache.set(ip, { value: NULL_GEO, expiresAt: Date.now() + NEGATIVE_TTL_MS });
      return NULL_GEO;
    }
    const value: GeoInfo = {
      country: data.country || null,
      region: data.regionName || null,
      city: data.city || null,
    };
    cache.set(ip, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    cache.set(ip, { value: NULL_GEO, expiresAt: Date.now() + NEGATIVE_TTL_MS });
    return NULL_GEO;
  }
}
