import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

function tenantKey(orgId: string) {
  const master = Buffer.from(process.env.MASTER_KEY ?? "", "base64");
  if (master.length !== 32) throw new Error("MASTER_KEY must be 32 bytes, base64-encoded");
  return Buffer.from(hkdfSync("sha256", master, orgId, "tenant-data-key", 32));
}

/** AES-256-GCM. Output layout: iv(12) | tag(16) | ciphertext. */
export function encrypt(orgId: string, plain: Buffer): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tenantKey(orgId), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), body]));
}

export function decrypt(orgId: string, blob: Uint8Array): Buffer {
  const b = Buffer.from(blob);
  const d = createDecipheriv("aes-256-gcm", tenantKey(orgId), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

export const encryptJson = (orgId: string, v: unknown) => Buffer.from(encrypt(orgId, Buffer.from(JSON.stringify(v)))).toString("base64");
export const decryptJson = <T = Record<string, any>>(orgId: string, s: string | null | undefined): T =>
  (s ? JSON.parse(decrypt(orgId, Buffer.from(s, "base64")).toString()) : {}) as T;

export const newToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");
