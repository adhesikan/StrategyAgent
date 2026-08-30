export function sanitizeApiResponseForLog(
  path: string,
  method: string,
  response: Record<string, unknown>,
): Record<string, unknown> {
  const isApiKeyCreation =
    method === "POST" &&
    /^\/api\/external-api\/clients\/[^/]+\/keys$/.test(path);
  return isApiKeyCreation && "key" in response
    ? { ...response, key: "[REDACTED]" }
    : response;
}