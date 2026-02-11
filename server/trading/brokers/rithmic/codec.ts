import protobuf from "protobufjs";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import templateIds from "./templateIds.json";

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const PROTO_DIR = path.join(__dirname_esm, "proto");

let rootInstance: protobuf.Root | null = null;

const idToMessage: Record<number, string> = {};
const messageToId: Record<string, number> = {};

for (const [msg, id] of Object.entries(templateIds)) {
  idToMessage[id] = msg;
  messageToId[msg] = id;
}

export function getTemplateId(messageName: string): number | undefined {
  return messageToId[messageName];
}

export function getMessageName(templateId: number): string | undefined {
  return idToMessage[templateId];
}

export async function loadProtoRoot(): Promise<protobuf.Root> {
  if (rootInstance) return rootInstance;

  if (!fs.existsSync(PROTO_DIR)) {
    throw new Error(`[RithmicCodec] Proto directory not found: ${PROTO_DIR}`);
  }

  const protoFiles = fs.readdirSync(PROTO_DIR).filter((f) => f.endsWith(".proto"));
  if (protoFiles.length === 0) {
    throw new Error("[RithmicCodec] No .proto files found");
  }

  const root = new protobuf.Root();
  root.resolvePath = (_origin: string, target: string) => {
    return path.join(PROTO_DIR, path.basename(target));
  };

  const loadPromises = protoFiles
    .filter((f) => f !== "otps_proto_pool.proto")
    .map((f) => path.join(PROTO_DIR, f));

  await root.load(loadPromises, { keepCase: false });
  root.resolveAll();

  rootInstance = root;
  console.log(`[RithmicCodec] Loaded ${protoFiles.length} proto definitions`);
  return root;
}

export function lookupType(messageName: string): protobuf.Type {
  if (!rootInstance) {
    throw new Error("[RithmicCodec] Proto root not loaded, call loadProtoRoot() first");
  }
  return rootInstance.lookupType(`rti.${messageName}`);
}

export function encode(messageName: string, payload: Record<string, unknown>): Buffer {
  const type = lookupType(messageName);
  const tid = getTemplateId(messageName);
  if (tid !== undefined) {
    payload.templateId = tid;
  }
  const msg = type.create(payload);
  const encoded = type.encode(msg).finish();
  return Buffer.from(encoded);
}

export function decode(messageName: string, buffer: Buffer | Uint8Array): Record<string, unknown> {
  const type = lookupType(messageName);
  const msg = type.decode(buffer instanceof Buffer ? new Uint8Array(buffer) : buffer);
  return type.toObject(msg, { longs: Number, enums: Number, defaults: true });
}

export function decodeByTemplateId(templateId: number, buffer: Buffer | Uint8Array): { name: string; data: Record<string, unknown> } | null {
  const name = getMessageName(templateId);
  if (!name) return null;

  try {
    const data = decode(name, buffer);
    return { name, data };
  } catch {
    return null;
  }
}

export async function validateProtos(): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  try {
    const root = await loadProtoRoot();

    const criticalMessages = [
      "Base",
      "RequestLogin",
      "ResponseLogin",
      "RequestHeartbeat",
      "ResponseHeartbeat",
      "RequestMarketDataUpdate",
      "ResponseMarketDataUpdate",
      "LastTrade",
      "BestBidOffer",
      "RequestNewOrder",
      "ResponseNewOrder",
      "RequestCancelOrder",
      "RithmicOrderNotification",
    ];

    for (const msg of criticalMessages) {
      try {
        root.lookupType(`rti.${msg}`);
      } catch {
        errors.push(`Missing critical message type: ${msg}`);
      }
    }

    return { valid: errors.length === 0, errors };
  } catch (err) {
    errors.push(`Proto load failed: ${err instanceof Error ? err.message : String(err)}`);
    return { valid: false, errors };
  }
}
