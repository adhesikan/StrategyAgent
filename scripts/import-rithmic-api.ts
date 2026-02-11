import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
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

    let protoCount = 0;
    let docCount = 0;

    function walkDir(dir: string) {
      if (!fs.existsSync(dir)) return;
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          if (item.name === "samples") continue;
          walkDir(fullPath);
        } else if (item.name.endsWith(".proto")) {
          const dest = path.join(PROTO_DEST, item.name);
          fs.copyFileSync(fullPath, dest);
          protoCount++;
        } else if (/\.(pdf|txt|md|doc|docx)$/i.test(item.name)) {
          const dest = path.join(DOCS_DEST, item.name);
          fs.copyFileSync(fullPath, dest);
          docCount++;
        }
      }
    }

    walkDir(EXTERNAL_DIR);

    console.log(`[RithmicImporter] Copied ${protoCount} proto files to ${PROTO_DEST}`);
    console.log(`[RithmicImporter] Copied ${docCount} doc files to ${DOCS_DEST}`);

    return protoCount > 0;
  } catch (err) {
    console.error("[RithmicImporter] Extraction failed:", err);
    return false;
  }
}

if (require.main === module) {
  importRithmicApi().then((ok) => {
    console.log(ok ? "[RithmicImporter] Success" : "[RithmicImporter] Failed");
    process.exit(ok ? 0 : 1);
  });
}
