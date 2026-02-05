import { execSync } from "child_process";

console.log("=== Starting Database Migration ===");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET (hidden)" : "NOT SET");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("Current directory:", process.cwd());

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set! Skipping migration.");
  process.exit(0);
}

try {
  console.log("Running drizzle-kit push --force...");
  const output = execSync("npx drizzle-kit push --force 2>&1", { 
    encoding: "utf-8",
    env: process.env 
  });
  console.log("Output:", output);
  console.log("=== Database Migration Complete ===");
} catch (error: any) {
  console.error("=== Database Migration FAILED ===");
  console.error("Exit code:", error.status);
  console.error("Stdout:", error.stdout);
  console.error("Stderr:", error.stderr);
  console.error("Error:", error.message);
  process.exit(1);
}
