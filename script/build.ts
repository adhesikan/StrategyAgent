import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { execSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  // Migrations always run at startup via server/index.ts — see "Startup migrations".
  // We only attempt drizzle-kit push at build time when the DB is actually reachable
  // (e.g. local dev). On Railway / Fly / containerized hosts the DB hostname
  // (postgres.railway.internal, etc.) is only resolvable at runtime, so we skip.
  const dbUrl = process.env.DATABASE_URL;
  const looksUnreachable =
    !dbUrl ||
    /\.railway\.internal/.test(dbUrl) ||
    /\.flycast/.test(dbUrl) ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.SKIP_BUILD_MIGRATIONS === "1";

  if (looksUnreachable) {
    console.log(
      "Skipping build-time drizzle-kit push (DB not reachable at build time). " +
        "Schema will be applied by startup migrations in server/index.ts.",
    );
  } else {
    console.log("running database migrations...");
    try {
      execSync("npx drizzle-kit push", { stdio: "inherit" });
      console.log("database migrations complete");
    } catch (error) {
      console.warn(
        "Build-time drizzle-kit push failed — startup migrations will retry.",
        error,
      );
    }
  }

  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
