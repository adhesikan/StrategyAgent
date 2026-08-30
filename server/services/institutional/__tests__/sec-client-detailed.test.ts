import { afterEach, describe, expect, it, vi } from "vitest";
import { secFetch, secFetchDetailed } from "../sec-client";

const originalAgent = process.env.SEC_USER_AGENT;
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalAgent === undefined) delete process.env.SEC_USER_AGENT;
  else process.env.SEC_USER_AGENT = originalAgent;
});

function utf16be(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set([0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) {
    out[2 + i * 2] = text.charCodeAt(i) >> 8;
    out[3 + i * 2] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

describe("SEC detailed byte decoding", () => {
  it("decodes UTF-16 BOMs, reports malformed UTF-8, and keeps secFetch replacement decoding", async () => {
    process.env.SEC_USER_AGENT = "Diagnostic test@example.com";
    const xml = `<?xml version="1.0"?><informationTable/>`;
    const leBody = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
    const responses = [
      new Response(leBody, { status: 200 }),
      new Response(utf16be(xml), { status: 200 }),
      new Response(Uint8Array.from([0x3c, 0xff, 0x3e]), { status: 200 }),
      new Response(Uint8Array.from([0x3c, 0xff, 0x3e]), { status: 200 }),
      new Response(`<?xml version="1.0" encoding="ISO-8859-1"?><informationTable/>`, { status: 200 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    const le = await secFetchDetailed("https://www.sec.gov/le");
    expect(le).toMatchObject({ detectedEncoding: "UTF-16LE", decodingError: false, byteLength: leBody.byteLength });
    expect(le.text).toContain("<informationTable");
    const be = await secFetchDetailed("https://www.sec.gov/be");
    expect(be).toMatchObject({ detectedEncoding: "UTF-16BE", decodingError: false });
    const malformed = await secFetchDetailed("https://www.sec.gov/bad");
    expect(malformed).toMatchObject({ detectedEncoding: "UTF-8", decodingError: true });
    expect(await secFetch("https://www.sec.gov/legacy")).toBe("<�>");
    expect(await secFetchDetailed("https://www.sec.gov/unsupported")).toMatchObject({
      detectedEncoding: "ISO-8859-1", decodingError: true,
    });
  });
});