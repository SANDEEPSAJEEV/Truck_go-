import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { prisma } from "../prisma";

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

/**
 * Postgres-backed storage.
 *
 * The local provider wrote to disk, which on Render means the file is gone at the next
 * deploy — a driver's licence scan survived until the next push and then silently vanished,
 * taking their verification with it.
 *
 * These are small (capped at 8MB), few (five per driver), and read rarely through an
 * authenticated route, so the database is a reasonable home: transactional, backed up
 * alongside everything else, and needing no third-party account. Object storage is the right
 * answer at scale, and this interface is why that swap will touch one file.
 */
export class DbStorageProvider implements StorageProvider {
  readonly name = "db";

  async put(buffer: Buffer, contentType: string, ext: string): Promise<StoredFile> {
    const key = `${crypto.randomBytes(16).toString("hex")}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
    await prisma.documentFile.create({
      // Prisma's Bytes maps to Uint8Array; Buffer is one, but its generic ArrayBufferLike
      // does not narrow to ArrayBuffer. Copying into a plain Uint8Array is exact and cheap.
      data: { key, contentType, size: buffer.length, data: new Uint8Array(buffer) },
    });
    return { key, contentType, size: buffer.length };
  }

  async get(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    const row = await prisma.documentFile.findUnique({ where: { key } });
    if (!row) throw new Error("Stored file not found");
    return { buffer: Buffer.from(row.data), contentType: row.contentType };
  }

  async delete(key: string): Promise<void> {
    await prisma.documentFile.delete({ where: { key } }).catch(() => {});
  }
}

let storage: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (storage) return storage;
  // Disk only where it survives a restart — a developer's machine. Anywhere else it is a
  // silent data-loss bug waiting for the next deploy.
  storage = process.env.UPLOAD_DIR ? new LocalStorageProvider() : new DbStorageProvider();
  return storage;
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
