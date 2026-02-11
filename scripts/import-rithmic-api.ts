import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

function resolveScriptDir(): string {
  try {
    if (typeof import.meta.url === "string" && import.meta.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {}
  if (typeof __dirname === "string") {
    return __dirname;
  }
  return process.cwd();
}

const scriptDir = resolveScriptDir();
const PROJECT_ROOT = scriptDir.endsWith("scripts")
  ? path.resolve(scriptDir, "..")
  : fs.existsSync(path.join(scriptDir, "package.json"))
    ? scriptDir
    : process.cwd();
const EXTERNAL_DIR = path.join(PROJECT_ROOT, "external", "rithmic_api_extracted");
const PROTO_DEST = path.join(PROJECT_ROOT, "server", "trading", "brokers", "rithmic", "proto");
const DOCS_DEST = path.join(PROJECT_ROOT, "server", "trading", "brokers", "rithmic", "docs");

function findRithmicZip(): string | null {
  const searchDirs = [PROJECT_ROOT, path.join(PROJECT_ROOT, "attached_assets")];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith(".zip") && /rithmic|rprotocol/i.test(file)) {
        return path.join(dir, file);
      }
    }
  }
  return null;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function walkDir(dir: string, counts: { proto: number; doc: number }) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      walkDir(fullPath, counts);
    } else if (item.name.endsWith(".proto")) {
      const dest = path.join(PROTO_DEST, item.name);
      fs.copyFileSync(fullPath, dest);
      counts.proto++;
    } else if (/\.(pdf|txt|md|doc|docx)$/i.test(item.name)) {
      const dest = path.join(DOCS_DEST, item.name);
      fs.copyFileSync(fullPath, dest);
      counts.doc++;
    }
  }
}

export async function importRithmicApi(): Promise<boolean> {
  const existingProtos = fs.existsSync(PROTO_DEST)
    ? fs.readdirSync(PROTO_DEST).filter((f) => f.endsWith(".proto"))
    : [];

  if (existingProtos.length > 10) {
    console.log(`[RithmicImporter] Proto files already present (${existingProtos.length} files), skipping extraction`);
    return true;
  }

  const zipPath = findRithmicZip();
  if (!zipPath) {
    console.log("[RithmicImporter] No Rithmic zip file found in project root or attached_assets/");
    return false;
  }

  console.log(`[RithmicImporter] Found zip: ${zipPath}`);

  try {
    ensureDir(EXTERNAL_DIR);
    ensureDir(PROTO_DEST);
    ensureDir(DOCS_DEST);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(EXTERNAL_DIR, true);
    console.log(`[RithmicImporter] Extracted to ${EXTERNAL_DIR}`);

    const counts = { proto: 0, doc: 0 };
    walkDir(EXTERNAL_DIR, counts);

    console.log(`[RithmicImporter] Copied ${counts.proto} proto files to ${PROTO_DEST}`);
    console.log(`[RithmicImporter] Copied ${counts.doc} doc files to ${DOCS_DEST}`);

    return counts.proto > 0;
  } catch (err) {
    console.error("[RithmicImporter] Extraction failed:", err);
    return false;
  }
}

const isMain = process.argv[1] && (
  process.argv[1].includes("import-rithmic-api") ||
  (typeof import.meta.url === "string" && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, "")))
);

if (isMain) {
  importRithmicApi().then((ok) => {
    console.log(ok ? "[RithmicImporter] Success" : "[RithmicImporter] Failed");
    process.exit(ok ? 0 : 1);
  });
}
