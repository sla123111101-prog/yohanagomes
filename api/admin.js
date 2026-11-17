import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { deleteBlob, readBlob, readJson, writeBytes, writeJson } from "../lib/blob-store.js";

const scrypt = promisify(scryptCallback);
const OWNER_NAME = "Yohana Gomes";
const SESSION_COOKIE = "yohana_admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SETUP_TTL_MS = 2 * 60 * 60 * 1000;
const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_VIDEO_SIZE = 300 * 1024 * 1024;
const MAX_VIDEOS = 10;
const MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ACCOUNT_PATH = "admin/owner-account.json";
const VIDEOS_PATH = "admin/videos.json";
const UPLOAD_PATH = "admin/active-upload.json";
const SESSION_EPOCH_PATH = "admin/session-epoch.json";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cookieOptions(request, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function cookieValue(request, name) {
  const part = request.headers.get("cookie")?.split(";").map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : null;
}

function setupKeyMatches(candidate) {
  const expected = process.env.ADMIN_SETUP_KEY || "";
  if (expected.length < 32 || typeof candidate !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const candidateBytes = Buffer.from(candidate);
  return expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes);
}

async function derivePassword(password, salt) {
  return Buffer.from(await scrypt(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  }));
}

function clientAddress(request) {
  return request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

async function checkLoginThrottle(request) {
  const key = `admin/login-rate/${sha256(clientAddress(request))}.json`;
  const value = await readJson(key);
  if (value?.until > Date.now() && value.count >= 8) {
    throw new ApiError(429, "Muitas tentativas. Aguarde 15 minutos e tente novamente.");
  }
  return key;
}

async function recordLoginFailure(key) {
  const existing = await readJson(key);
  const now = Date.now();
  const current = existing?.until > now ? existing : { count: 0, until: now + 15 * 60 * 1000 };
  await writeJson(key, { count: current.count + 1, until: current.until }, { ttlDays: 1 });
}

async function readEpoch() {
  return (await readJson(SESSION_EPOCH_PATH))?.value || 0;
}

async function startSession(request) {
  const token = randomBytes(32).toString("base64url");
  await writeJson(`admin/sessions/${sha256(token)}.json`, {
    owner: OWNER_NAME,
    epoch: await readEpoch(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }, { allowOverwrite: false, ttlDays: 7 });
  return json({ ok: true, owner: OWNER_NAME }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=${token}; ${cookieOptions(request, SESSION_TTL_MS / 1000)}`,
  });
}

async function getSession(request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const key = `admin/sessions/${sha256(token)}.json`;
  const session = await readJson(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now() || session.epoch !== await readEpoch()) {
    await deleteBlob(key);
    return null;
  }
  return { key, session };
}

async function requireSession(request) {
  const active = await getSession(request);
  if (!active) throw new ApiError(401, "Sua sessao expirou. Entre novamente.");
  return active;
}

function cleanFileName(value) {
  return String(value || "video").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120);
}

function acceptedVideoType(type, filename) {
  if (MIME_TYPES.has(type)) return type;
  const extension = String(filename || "").toLowerCase().split(".").pop();
  if (extension === "mp4" || extension === "m4v") return "video/mp4";
  if (extension === "webm") return "video/webm";
  if (extension === "mov") return "video/quicktime";
  return null;
}

function chunkPath(uploadId, index) {
  return `videos/chunks/${uploadId}/${index}.part`;
}

async function deleteChunks(uploadId, count) {
  if (!uploadId || !Number.isInteger(count)) return;
  for (let start = 0; start < count; start += 20) {
    await Promise.allSettled(Array.from(
      { length: Math.min(20, count - start) },
      (_, offset) => deleteBlob(chunkPath(uploadId, start + offset)),
    ));
  }
}

async function readVideos() {
  const videos = await readJson(VIDEOS_PATH);
  if (Array.isArray(videos)) return videos;
  const legacyVideo = await readJson("admin/current-video.json");
  return legacyVideo ? [{ ...legacyVideo, title: legacyVideo.title || legacyVideo.name }] : [];
}

async function handleGet(request, action) {
  if (action === "public-status") {
    const videos = await readVideos();
    return json({ videos: videos.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })) });
  }
  if (action === "status") {
    const account = await readJson(ACCOUNT_PATH);
    const active = await getSession(request);
    const result = {
      owner: OWNER_NAME,
      setupRequired: !account,
      setupConfigured: (process.env.ADMIN_SETUP_KEY || "").length >= 32,
      authenticated: Boolean(active),
    };
    if (active) result.videos = await readVideos();
    return json(result);
  }
  throw new ApiError(404, "Acao desconhecida.");
}

async function handlePost(request, action) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "Nao consegui ler os dados enviados.");
  }

  if (action === "setup") {
    if (await readJson(ACCOUNT_PATH)) throw new ApiError(409, "A conta ja foi configurada.");
    if (!setupKeyMatches(body.setupKey)) {
      throw new ApiError(403, "Codigo inicial incorreto ou nao configurado na Vercel.");
    }
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 256) {
      throw new ApiError(400, "Use uma senha com pelo menos 12 caracteres.");
    }
    const salt = randomBytes(16);
    const hash = await derivePassword(body.password, salt);
    try {
      await writeJson(ACCOUNT_PATH, {
        owner: OWNER_NAME,
        salt: salt.toString("base64url"),
        hash: hash.toString("base64url"),
        createdAt: new Date().toISOString(),
      }, { allowOverwrite: false });
    } catch (error) {
      if (await readJson(ACCOUNT_PATH)) throw new ApiError(409, "A conta ja foi configurada.");
      throw error;
    }
    return startSession(request);
  }

  if (action === "login") {
    const throttleKey = await checkLoginThrottle(request);
    const account = await readJson(ACCOUNT_PATH);
    if (!account) throw new ApiError(409, "Configure a conta proprietaria primeiro.");
    if (typeof body.password !== "string" || body.password.length > 256) {
      await recordLoginFailure(throttleKey);
      throw new ApiError(401, "Senha incorreta.");
    }
    const actual = await derivePassword(body.password, Buffer.from(account.salt, "base64url"));
    const expected = Buffer.from(account.hash, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await recordLoginFailure(throttleKey);
      throw new ApiError(401, "Senha incorreta.");
    }
    await deleteBlob(throttleKey);
    return startSession(request);
  }

  if (action === "logout") {
    const active = await getSession(request);
    if (active) await deleteBlob(active.key);
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; ${cookieOptions(request, 0)}`,
    });
  }

  if (action === "reset-account") {
    await requireSession(request);
    const account = await readJson(ACCOUNT_PATH);
    if (!account) throw new ApiError(409, "A conta ja esta no primeiro acesso.");
    if (!setupKeyMatches(body.setupKey)) {
      throw new ApiError(403, "O codigo inicial nao esta configurado ou esta incorreto.");
    }
    if (typeof body.password !== "string" || body.password.length > 256) {
      throw new ApiError(401, "Confirme sua senha atual para continuar.");
    }
    const actual = await derivePassword(body.password, Buffer.from(account.salt, "base64url"));
    const expected = Buffer.from(account.hash, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ApiError(401, "A senha atual esta incorreta.");
    }
    await writeJson(SESSION_EPOCH_PATH, { value: (await readEpoch()) + 1 });
    await deleteBlob(ACCOUNT_PATH);
    return json({ ok: true }, 200, {
      "Set-Cookie": `${SESSION_COOKIE}=; ${cookieOptions(request, 0)}`,
    });
  }

  if (action === "video-init") {
    await requireSession(request);
    const videos = await readVideos();
    if (videos.length >= MAX_VIDEOS) {
      throw new ApiError(409, "O limite de 10 videos foi atingido. Remova um video para adicionar outro.");
    }
    const size = Number(body.size);
    const type = acceptedVideoType(body.type, body.name);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_VIDEO_SIZE) {
      throw new ApiError(400, "O video precisa ter entre 1 byte e 300 MB.");
    }
    if (!type) throw new ApiError(415, "Envie um video MP4, WebM ou MOV.");
    if (!title || title.length > 100) {
      throw new ApiError(400, "Informe um titulo de ate 100 caracteres para este video.");
    }

    const oldUpload = await readJson(UPLOAD_PATH);
    if (oldUpload) await deleteChunks(oldUpload.id, oldUpload.chunkCount);
    const upload = {
      id: randomBytes(18).toString("base64url"), size, type,
      name: cleanFileName(body.name), title,
      chunkCount: Math.ceil(size / CHUNK_SIZE),
      expiresAt: Date.now() + SETUP_TTL_MS,
    };
    await writeJson(UPLOAD_PATH, upload);
    return json({ uploadId: upload.id, chunkSize: CHUNK_SIZE, chunkCount: upload.chunkCount });
  }

  if (action === "video-complete") {
    await requireSession(request);
    const pending = await readJson(UPLOAD_PATH);
    if (!pending || pending.id !== body.uploadId || pending.expiresAt <= Date.now()) {
      throw new ApiError(400, "Este envio expirou. Selecione o video novamente.");
    }
    for (let index = 0; index < pending.chunkCount; index += 1) {
      const chunk = await readBlob(chunkPath(pending.id, index));
      if (!chunk) throw new ApiError(400, "O envio ainda esta incompleto. Tente selecionar o video novamente.");
      await chunk.stream?.cancel();
    }
    const videos = await readVideos();
    if (videos.length >= MAX_VIDEOS) {
      throw new ApiError(409, "O limite de 10 videos foi atingido. Remova um video antes de concluir o envio.");
    }
    const video = {
      id: pending.id, title: pending.title, size: pending.size, type: pending.type,
      name: pending.name, chunkCount: pending.chunkCount, updatedAt: new Date().toISOString(),
    };
    const updatedVideos = [...videos, video];
    await writeJson(VIDEOS_PATH, updatedVideos);
    await deleteBlob("admin/current-video.json");
    await deleteBlob(UPLOAD_PATH);
    return json({ ok: true, videos: updatedVideos });
  }

  if (action === "video-delete") {
    await requireSession(request);
    const videoId = typeof body.id === "string" ? body.id : "";
    if (!videoId) throw new ApiError(400, "Selecione o video que deseja remover.");
    const videos = await readVideos();
    const video = videos.find((item) => item.id === videoId);
    if (!video) throw new ApiError(404, "Este video nao esta mais na lista.");
    const updatedVideos = videos.filter((item) => item.id !== videoId);
    await writeJson(VIDEOS_PATH, updatedVideos);
    await deleteBlob("admin/current-video.json");
    await deleteChunks(video.id, video.chunkCount);
    return json({ ok: true, videos: updatedVideos });
  }

  throw new ApiError(404, "Acao desconhecida.");
}

async function handleChunk(request, url) {
  await requireSession(request);
  const uploadId = url.searchParams.get("uploadId") || "";
  const index = Number(url.searchParams.get("index"));
  if (!/^[A-Za-z0-9_-]{20,30}$/.test(uploadId) || !Number.isInteger(index)) {
    throw new ApiError(400, "Bloco de video invalido.");
  }
  const pending = await readJson(UPLOAD_PATH);
  if (!pending || pending.id !== uploadId || pending.expiresAt <= Date.now()) {
    throw new ApiError(400, "Este envio expirou. Selecione o video novamente.");
  }
  if (index < 0 || index >= pending.chunkCount) throw new ApiError(400, "Bloco de video invalido.");
  const chunk = Buffer.from(await request.arrayBuffer());
  const expectedSize = Math.min(CHUNK_SIZE, pending.size - index * CHUNK_SIZE);
  if (chunk.byteLength !== expectedSize) throw new ApiError(400, "O tamanho de um bloco nao confere.");
  await writeBytes(chunkPath(uploadId, index), chunk);
  return json({ ok: true, index });
}

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");
      if (request.method === "GET") return await handleGet(request, action);
      if (request.method === "POST") return await handlePost(request, action);
      if (request.method === "PUT" && action === "video-chunk") return await handleChunk(request, url);
      return json({ error: "Metodo nao permitido." }, 405, { Allow: "GET, POST, PUT" });
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error("Vercel Admin API error", error);
      return json({ error: "O servidor nao conseguiu concluir a solicitacao." }, 500);
    }
  },
};
