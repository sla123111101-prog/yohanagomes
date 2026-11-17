import { readBlobBytes, readJson } from "../lib/blob-store.js";

const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_RANGE_SIZE = 3 * 1024 * 1024;

function response(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function parseRange(header, total) {
  if (!header) return { start: 0, end: Math.min(total - 1, MAX_RANGE_SIZE - 1) };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, total - Math.min(suffix, MAX_RANGE_SIZE));
    end = total - 1;
  } else {
    start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
      || start >= total || requestedEnd < start) return null;
    end = Math.min(requestedEnd, total - 1, start + MAX_RANGE_SIZE - 1);
  }
  return { start, end };
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return response(null, 405, { Allow: "GET, HEAD" });
    }

    try {
      const videos = await readJson("admin/videos.json") || [];
      const requestedId = new URL(request.url).searchParams.get("id");
      const video = requestedId ? videos.find((item) => item.id === requestedId) : videos[0];
      if (!video) return response("No video", 404, { "Content-Type": "text/plain; charset=utf-8" });

      const baseHeaders = {
        "Accept-Ranges": "bytes",
        "Content-Type": video.type,
        "Content-Disposition": "inline",
      };
      if (request.method === "HEAD") {
        return response(null, 200, { ...baseHeaders, "Content-Length": String(video.size) });
      }

      const range = parseRange(request.headers.get("range"), video.size);
      if (!range) {
        return response(null, 416, { ...baseHeaders, "Content-Range": `bytes */${video.size}` });
      }

      const pieces = [];
      const firstChunk = Math.floor(range.start / CHUNK_SIZE);
      const lastChunk = Math.floor(range.end / CHUNK_SIZE);
      for (let index = firstChunk; index <= lastChunk; index += 1) {
        const chunk = await readBlobBytes(`videos/chunks/${video.id}/${index}.part`);
        if (!chunk) return response("Video unavailable", 503, { "Content-Type": "text/plain; charset=utf-8" });
        const localStart = index === firstChunk ? range.start % CHUNK_SIZE : 0;
        const localEnd = index === lastChunk ? (range.end % CHUNK_SIZE) + 1 : chunk.length;
        pieces.push(chunk.subarray(localStart, localEnd));
      }

      const body = Buffer.concat(pieces);
      return response(body, 206, {
        ...baseHeaders,
        "Content-Length": String(body.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${video.size}`,
      });
    } catch (error) {
      console.error("Vercel media delivery error", error);
      return response("Video unavailable", 503, { "Content-Type": "text/plain; charset=utf-8" });
    }
  },
};
