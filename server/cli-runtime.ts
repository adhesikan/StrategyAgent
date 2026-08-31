export interface CliRuntimeOptions {
  label: string;
  close: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 500);
}

/**
 * Runs a one-shot CLI without hard-exiting before stdout/stderr and cleanup
 * have completed. The caller assigns the returned status to process.exitCode.
 */
export async function runCli(
  main: () => Promise<void>,
  options: CliRuntimeOptions,
): Promise<number> {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    console.error(`[${options.label}] ERROR: ${errorMessage(error)}`);
    exitCode = 1;
  }

  try {
    await options.close();
  } catch (error) {
    console.error(`[${options.label}] CLOSE_ERROR: ${errorMessage(error)}`);
    exitCode = 1;
  }

  return exitCode;
}