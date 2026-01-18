function hex(byte) {
  return byte.toString(16).padStart(2, '0');
}

function bytesToUuid(bytes) {
  const b = bytes;
  return (
    hex(b[0]) +
    hex(b[1]) +
    hex(b[2]) +
    hex(b[3]) +
    '-' +
    hex(b[4]) +
    hex(b[5]) +
    '-' +
    hex(b[6]) +
    hex(b[7]) +
    '-' +
    hex(b[8]) +
    hex(b[9]) +
    '-' +
    hex(b[10]) +
    hex(b[11]) +
    hex(b[12]) +
    hex(b[13]) +
    hex(b[14]) +
    hex(b[15])
  );
}

export function uuidv4() {
  const g = globalThis;
  try {
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  } catch {
    // ignore
  }

  const bytes = new Uint8Array(16);
  try {
    if (g?.crypto?.getRandomValues) {
      g.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  // RFC 4122 v4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

