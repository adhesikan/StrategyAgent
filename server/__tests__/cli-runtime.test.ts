import { describe, expect, it, vi } from "vitest";
import { runCli } from "../cli-runtime";

describe("one-shot CLI runtime", () => {
  it("lets successful stdout complete before closing resources", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runCli(
      async () => console.log(JSON.stringify({ ok: true })),
      { label: "test-cli", close },
    );

    expect(exitCode).toBe(0);
    expect(output).toHaveBeenCalledWith('{"ok":true}');
    expect(close).toHaveBeenCalledOnce();
    output.mockRestore();
  });

  it("reports errors to stderr, closes resources, and returns a failure status", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const exitCode = await runCli(
      async () => { throw new Error("CLI_FAILURE"); },
      { label: "test-cli", close },
    );

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith("[test-cli] ERROR: CLI_FAILURE");
    expect(close).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("turns cleanup failures into an observable failure status", async () => {
    const close = vi.fn().mockRejectedValue(new Error("POOL_CLOSE_FAILURE"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const exitCode = await runCli(async () => undefined, { label: "test-cli", close });

    expect(exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith("[test-cli] CLOSE_ERROR: POOL_CLOSE_FAILURE");
    error.mockRestore();
  });

  it("reports a safe database cause instead of hiding it behind a failed query", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cause = Object.assign(new Error('column reference "period_of_report" is ambiguous'), { code: "42702" });
    const error = Object.assign(new Error("Failed query: SELECT sensitive-looking SQL"), { cause });

    const exitCode = await runCli(
      async () => { throw error; },
      { label: "test-cli", close },
    );

    expect(exitCode).toBe(1);
    expect(errorOutput).toHaveBeenCalledWith(
      '[test-cli] ERROR: column reference "period_of_report" is ambiguous [code=42702]',
    );
    errorOutput.mockRestore();
  });
});