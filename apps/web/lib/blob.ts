import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { HttpError } from "./http";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const LOCAL_DIR = join(process.cwd(), "data", "uploads");

export async function compressPhoto(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

export async function storePhoto(buffer: Buffer): Promise<string> {
  const jpeg = await compressPhoto(buffer);
  const name = `${randomBytes(18).toString("hex")}.jpg`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`chores/${name}`, jpeg, {
      access: "public",
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: "image/jpeg",
      addRandomSuffix: false,
    });
    return blob.url;
  }

  await mkdir(LOCAL_DIR, { recursive: true });
  const path = join(LOCAL_DIR, name);
  await pipeline(Readable.from(jpeg), createWriteStream(path));
  return `local:${name}`;
}

export async function readPhoto(path: string): Promise<{ body: Uint8Array; contentType: string }> {
  if (path.startsWith("local:")) {
    const file = join(LOCAL_DIR, path.slice(6));
    const buf = await readFile(file);
    return { body: new Uint8Array(buf), contentType: "image/jpeg" };
  }
  if (path.startsWith("http")) {
    const res = await fetch(path);
    if (!res.ok) throw new HttpError(404, "Photo is gone.");
    return { body: new Uint8Array(await res.arrayBuffer()), contentType: "image/jpeg" };
  }
  throw new HttpError(404, "Photo is gone.");
}

export async function readUpload(req: Request): Promise<Buffer> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("photo") ?? form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Attach a photo.");
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, "That photo is too large.");
    return Buffer.from(await file.arrayBuffer());
  }
  const raw = Buffer.from(await req.arrayBuffer());
  if (!raw.length) throw new HttpError(400, "Attach a photo.");
  if (raw.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "That photo is too large.");
  return raw;
}
