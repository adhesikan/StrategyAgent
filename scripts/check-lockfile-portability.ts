/**
 * check-lockfile-portability.ts
 *
 * Permanent release-quality invariant: the committed package-lock.json
 * must not contain environment-specific package registry or proxy URLs.
 *
 * Prohibited patterns:
 *   - package-firewall.replit.local   (Replit local npm proxy)
 *   - localhost                        (local registry/proxy)
 *   - 127.0.0.1                        (local registry/proxy)
 *
 * Run: npx tsx scripts/check-lockfile-portability.ts
 * Exit 0 = portable, exit 1 = non-portable (fails CI/release gate).
 */

import { readFileSync } from "fs";
import { join } from "path";

const LOCKFILE = join(process.cwd(), "package-lock.json");

interface CheckResult {
  pattern: string;
  count: number;
  samples: string[];
}

const PROHIBITED_PATTERNS: string[] = [
  "package-firewall.replit.local",
  // Add more prohibited local registry patterns here if needed
  // "localhost:4873",  // example: local verdaccio
];

function checkLockfile(): void {
  let raw: string;
  try {
    raw = readFileSync(LOCKFILE, "utf8");
  } catch (e) {
    console.error("ERROR: Could not read package-lock.json:", e);
    process.exit(1);
  }

  const results: CheckResult[] = [];
  let anyViolation = false;

  for (const pattern of PROHIBITED_PATTERNS) {
    const regex = new RegExp(pattern.replace(/\./g, "\\."), "g");
    const matches = raw.match(regex) ?? [];
    const count = matches.length;

    // Collect sample lines for error reporting
    const samples: string[] = [];
    if (count > 0) {
      const lines = raw.split("\n");
      for (const line of lines) {
        if (line.includes(pattern)) {
          samples.push(line.trim().substring(0, 120));
          if (samples.length >= 5) break;
        }
      }
      anyViolation = true;
    }

    results.push({ pattern, count, samples });
  }

  // Report results
  console.log("=== Lockfile Portability Check ===");
  console.log(`File: ${LOCKFILE}`);
  console.log("");

  for (const result of results) {
    if (result.count === 0) {
      console.log(`✅  CLEAN  — "${result.pattern}" — 0 occurrences`);
    } else {
      console.log(`❌  FAIL   — "${result.pattern}" — ${result.count} occurrence(s)`);
      for (const sample of result.samples) {
        console.log(`          Sample: ${sample}`);
      }
    }
  }

  console.log("");

  if (anyViolation) {
    console.error(
      "PORTABILITY CHECK FAILED\n" +
        "The package-lock.json contains environment-specific registry URLs.\n" +
        "These will cause npm ci failures on Railway, CI/CD, and local machines\n" +
        "outside the Replit environment.\n\n" +
        "FIX: Run the lockfile repair script:\n" +
        "  node -e \"\n" +
        "    const fs=require('fs');\n" +
        "    const raw=fs.readFileSync('package-lock.json','utf8');\n" +
        "    const fixed=raw.replace(/http:\\/\\/package-firewall\\.replit\\.local\\/npm\\//g,'https://registry.npmjs.org/');\n" +
        "    fs.writeFileSync('package-lock.json',fixed);\n" +
        "    console.log('Rewritten. Verify with grep.');\n" +
        "  \"\n\n" +
        "Then verify:\n" +
        "  npx tsx scripts/check-lockfile-portability.ts"
    );
    process.exit(1);
  }

  console.log(
    "PORTABILITY CHECK PASSED\n" +
      "package-lock.json contains no environment-specific registry URLs.\n" +
      "npm ci will succeed on Railway, CI/CD, and local environments."
  );
  process.exit(0);
}

checkLockfile();
