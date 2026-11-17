import { del, get, put } from "@vercel/blob";

const PRIVATE = { access: "private", useCache: false };

export function readBlob(pathname) {
  return get(pathname, PRIVATE);
}

export async function readJson(pathname) {
  const result = await readBlob(pathname);
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return JSON.parse(await new Response(result.stream).text());
}

export async function writeJson(pathname, value, { allowOverwrite = true, ttlDays } = {}) {
  return put(pathname, JSON.stringify(value), {
    access: "private",
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
    allowOverwrite,
    ...(ttlDays ? { ttlDays } : {}),
  });
}

export async function writeBytes(pathname, value, contentType = "application/octet-stream") {
  return put(pathname, value, {
    access: "private",
    contentType,
    cacheControlMaxAge: 60,
    allowOverwrite: true,
  });
}

export function deleteBlob(pathname) {
  return del(pathname);
}

export async function readBlobBytes(pathname) {
  const result = await readBlob(pathname);
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}
