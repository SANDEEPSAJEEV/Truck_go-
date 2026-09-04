import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

// Identity documents are among the most sensitive data this system holds. They are stored
// under an unguessable key and served only through an authenticated route — never from a
// public directory, and never at a URL that can be guessed from a driver id.

export interface StoredFile {
  key: string;
  contentType: string;
  size: number;
}

export interface StorageProvider {
  readonly name: string;
  put(buffer: Buffer, contentType: string, ext: string): Promise<StoredFile>;
  get(key: string): Promise<{ buffer: Buffer; contentType: string }>;
  delete(key: string): Promise<void>;
}

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

/** Local disk, for development. Production should use S3/R2 behind the same interface. */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  private keyToPath(key: string): string {
    // Keys are generated here and are hex + extension only. Reject anything else outright
    // so a crafted key can never escape the upload directory.
    if (!/^[a-f0-9]{32}\.[a-z0-9]{1,8}$/.test(key)) {
      throw new Error("Invalid storage key");
    }
    return path.join(UPLOAD_DIR, key);
  }

  async put(buffer: Buffer, contentType: string, ext: string): Promise<StoredFile> {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const key = `${crypto.randomBytes(16).toString("hex")}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    await fs.writeFile(this.keyToPath(key), buffer);
    return { key, contentType, size: buffer.length };
  }

  async get(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const buffer = await fs.readFile(this.keyToPath(key));
    return { buffer, contentType: contentTypeFor(key) };
  }

  async delete(key: string): Promise<void> {
    await fs.unlink(this.keyToPath(key)).catch(() => {});
  }
}

function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  return "image/jpeg";
}

let storage: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!storage) storage = new LocalStorageProvider();
  return storage;
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
