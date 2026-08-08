#!/usr/bin/env tsx
// scripts/check-operations-docs.ts — Sprint 2.3.6A
//
// Advisory checker: warns when operational code changes but docs/operations/
// files are not updated. Intended for local pre-commit or CI advisory use.
//
// Usage:
//   npx tsx scripts/check-operations-docs.ts             # check staged changes
//   npx tsx scripts/check-operations-docs.ts --all       # check entire git diff (last commit)
//   npx tsx scripts/check-operations-docs.ts --help
//
// Exit behavior: advisory only — exits 0 even when warning fires.
// CI enforcement is a backlog item (see 15-known-issues-and-backlog.md).

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OPERATIONAL_DIRS = [
  "server/routes/",
  "server/services/",
  "shared/schema.ts",
  "script/",
  "scripts/",
];

const DOCS_DIR = "docs/operations/";

const EXCLUDED = [
  // Self-referential — this script changing doesn't require docs update
  "scripts/check-operations-docs.ts",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getChangedFiles(mode: "staged" | "last-commit"): string[] {
  try {
    const cmd =
      mode === "staged"
        ? "git diff --cached --name-only"
        : "git diff HEAD~1 --name-only";
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    if (!output) return [];
    return output.split("\n").map(f => f.trim()).filter(Boolean);
  } catch {
    // Not in a git repo or no commits — skip
    return [];
  }
}

function isOperationalFile(file: string): boolean {
  if (EXCLUDED.some(ex => file.includes(ex))) return false;
  return OPERATIONAL_DIRS.some(dir =>
    dir.endsWith(".ts")
      ? file === dir || file.endsWith(dir)
      : file.startsWith(dir)
  );
}

function isDocsFile(file: string): boolean {
  return file.startsWith(DOCS_DIR);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
check-operations-docs.ts — Operations Manual update checker

Usage:
  npx tsx scripts/check-operations-docs.ts             Check staged files
  npx tsx scripts/check-operations-docs.ts --all       Check last commit
  npx tsx scripts/check-operations-docs.ts --help      Show this help

Exit codes:
  0 — always (advisory mode; CI enforcement is backlog)

When to act on the warning:
  Update at least docs/operations/17-sprint-change-log.md and any
  other sections relevant to your change. See docs/operations/README.md
  for the complete Definition of Done.
`);
  process.exit(0);
}

const mode = args.includes("--all") ? "last-commit" : "staged";
const changed = getChangedFiles(mode);

if (changed.length === 0) {
  console.log("[ops-docs] No changed files detected — nothing to check.");
  process.exit(0);
}

const operationalChanged = changed.filter(isOperationalFile);
const docsChanged        = changed.filter(isDocsFile);

if (operationalChanged.length === 0) {
  // No operational code changed — nothing to warn about
  process.exit(0);
}

if (docsChanged.length > 0) {
  // Docs were updated — good
  console.log(
    `[ops-docs] ✓ Operational code changed (${operationalChanged.length} files) and` +
    ` docs/operations/ updated (${docsChanged.length} files). Looks good.`
  );
  process.exit(0);
}

// Docs NOT updated — print advisory warning
console.warn(`
╔════════════════════════════════════════════════════════════════╗
║  ADVISORY: Operations Manual may need updating                 ║
╠════════════════════════════════════════════════════════════════╣
║  Operational code changed but docs/operations/ was not updated ║
╚════════════════════════════════════════════════════════════════╝

Changed operational files (${operationalChanged.length}):
${operationalChanged.slice(0, 10).map(f => "  - " + f).join("\n")}${operationalChanged.length > 10 ? `\n  ... and ${operationalChanged.length - 10} more` : ""}

At minimum, update:
  docs/operations/17-sprint-change-log.md

If routes changed:  docs/operations/16-api-and-uat-reference.md
If schema changed:  docs/operations/03-database-and-migrations.md
If new incidents:   docs/operations/11-troubleshooting-runbook.md
If new env vars:    docs/operations/02-environments-and-deployment.md

See docs/operations/README.md for the full Definition of Done.

This is advisory only — exit 0. CI enforcement is a backlog item.
`);

// Advisory: always exit 0 (non-blocking)
process.exit(0);
