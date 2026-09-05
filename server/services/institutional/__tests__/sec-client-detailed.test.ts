import { afterEach, describe, expect, it, vi } from "vitest";
import { secFetch, secFetchBufferDetailed, secFetchDetailed } from "../sec-client";

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
  it("decodes UTF-16 BOMs and safe legacy single-byte encodings, and fails closed on malformed or unknown encodings", async () => {
    process.env.SEC_USER_AGENT = "Diagnostic test@example.com";
    const xml = `<?xml version="1.0"?><informationTable/>`;
    const leBody = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
    const latin1Body = Buffer.from(
      `<?xml version="1.0" encoding="ISO-8859-1"?><informationTable><infoTable>` +
      `<nameOfIssuer>CAF\xE9 \xC9</nameOfIssuer></infoTable></informationTable>`,
      "latin1",
    );
    const cp1252Body = Buffer.concat([
      Buffer.from(`<?xml version="1.0" encoding="Windows-1252"?><informationTable><infoTable><nameOfIssuer>R`, "latin1"),
      Buffer.from([0xe9, 0x73, 0x75, 0x6d, 0xe9]), // "ésumé" — 0xE9 maps identically in Latin-1 and CP1252
      Buffer.from(`</nameOfIssuer></infoTable></informationTable>`, "latin1"),
    ]);
    const asciiCleanBody = Buffer.from(
      `<?xml version="1.0" encoding="US-ASCII"?><informationTable><infoTable/></informationTable>`, "latin1");
    const asciiDirtyBody = Buffer.concat([
      Buffer.from(`<?xml version="1.0" encoding="US-ASCII"?><informationTable><infoTable><nameOfIssuer>X`, "latin1"),
      Buffer.from([0xe9]),
      Buffer.from(`</nameOfIssuer></infoTable></informationTable>`, "latin1"),
    ]);
    const responses = [
      new Response(leBody, { status: 200 }),
      new Response(utf16be(xml), { status: 200 }),
      new Response(Uint8Array.from([0x3c, 0xff, 0x3e]), { status: 200 }),
      new Response(Uint8Array.from([0x3c, 0xff, 0x3e]), { status: 200 }),
      new Response(latin1Body, { status: 200 }),
      new Response(cp1252Body, { status: 200 }),
      new Response(asciiCleanBody, { status: 200 }),
      new Response(asciiDirtyBody, { status: 200 }),
      new Response(`<?xml version="1.0" encoding="Shift_JIS"?><informationTable/>`, { status: 200 }),
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

    // ISO-8859-1 declared XML with real Latin-1 bytes decodes correctly.
    const latin1 = await secFetchDetailed("https://www.sec.gov/latin1");
    expect(latin1).toMatchObject({ detectedEncoding: "ISO-8859-1", decodingError: false });
    expect(latin1.text).toContain("CAFé É");

    // Windows-1252 declared XML decodes without a CONTENT_ENCODING_ERROR
    // (bytes shared with Latin-1 decode identically across runtimes).
    const cp1252 = await secFetchDetailed("https://www.sec.gov/cp1252");
    expect(cp1252).toMatchObject({ detectedEncoding: "WINDOWS-1252", decodingError: false });
    expect(cp1252.text).toContain("Résumé");

    // US-ASCII is honoured strictly: clean ASCII passes, a non-ASCII byte fails closed.
    const asciiClean = await secFetchDetailed("https://www.sec.gov/ascii-clean");
    expect(asciiClean).toMatchObject({ detectedEncoding: "US-ASCII", decodingError: false });
    const asciiDirty = await secFetchDetailed("https://www.sec.gov/ascii-dirty");
    expect(asciiDirty).toMatchObject({ decodingError: true });

    // An encoding we do not explicitly support still fails closed.
    expect(await secFetchDetailed("https://www.sec.gov/shiftjis")).toMatchObject({
      detectedEncoding: "SHIFT_JIS", decodingError: true,
    });
  });

  it("cancels an in-flight archive download without retrying", async () => {
    process.env.SEC_USER_AGENT = "Diagnostic test@example.com";
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const download = secFetchBufferDetailed("https://www.sec.gov/archive.zip", controller.signal);
    controller.abort();

    await expect(download).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});