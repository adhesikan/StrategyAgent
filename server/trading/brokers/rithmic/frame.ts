import { lookupType, getTemplateId, getMessageName } from "./codec";

export function packMessage(messageName: string, payload: Record<string, unknown>): Buffer {
  const type = lookupType(messageName);
  const tid = getTemplateId(messageName);
  if (tid !== undefined) {
    payload.templateId = tid;
  }
  const msg = type.create(payload);
  const body = Buffer.from(type.encode(msg).finish());

  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32BE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export function unpackFrames(buffer: Buffer): { messages: Buffer[]; remainder: Buffer } {
  const messages: Buffer[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const msgLen = buffer.readUInt32BE(offset);
    if (offset + 4 + msgLen > buffer.length) break;
    messages.push(buffer.subarray(offset + 4, offset + 4 + msgLen));
    offset += 4 + msgLen;
  }

  return {
    messages,
    remainder: offset < buffer.length ? buffer.subarray(offset) : Buffer.alloc(0),
  };
}

export function peekTemplateId(msgBuf: Buffer): number | null {
  try {
    const BaseType = lookupType("RequestHeartbeat");
    const decoded = BaseType.decode(new Uint8Array(msgBuf));
    const obj = BaseType.toObject(decoded, { defaults: false }) as Record<string, unknown>;
    return typeof obj.templateId === "number" ? obj.templateId : null;
  } catch {
    return null;
  }
}

export function peekTemplateIdFast(msgBuf: Buffer): number | null {
  let offset = 0;
  while (offset < msgBuf.length) {
    const tag = readVarint(msgBuf, offset);
    if (!tag) break;
    offset = tag.newOffset;

    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x07;

    if (fieldNumber === 154467 && wireType === 0) {
      const val = readVarint(msgBuf, offset);
      return val ? val.value : null;
    }

    switch (wireType) {
      case 0: {
        const v = readVarint(msgBuf, offset);
        if (!v) return null;
        offset = v.newOffset;
        break;
      }
      case 1:
        offset += 8;
        break;
      case 2: {
        const len = readVarint(msgBuf, offset);
        if (!len) return null;
        offset = len.newOffset + len.value;
        break;
      }
      case 5:
        offset += 4;
        break;
      default:
        return null;
    }
  }
  return null;
}

function readVarint(buf: Buffer, offset: number): { value: number; newOffset: number } | null {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const byte = buf[pos];
    result |= (byte & 0x7f) << shift;
    pos++;
    if ((byte & 0x80) === 0) {
      return { value: result >>> 0, newOffset: pos };
    }
    shift += 7;
    if (shift >= 35) return null;
  }
  return null;
}
