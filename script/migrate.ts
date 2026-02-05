import { execSync } from "child_process";

console.log("=== Starting Database Migration ===");
console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET (hidden)" : "NOT SET");

try {
  console.log("Running drizzle-kit push...");
  execSync("npx drizzle-kit push", { 
    stdio: "inherit",
    env: process.env 
  });
  console.log("=== Database Migration Complete ===");
} catch (error) {
  console.error("=== Database Migration FAILED ===");
  console.error(error);
  process.exit(1);
}
