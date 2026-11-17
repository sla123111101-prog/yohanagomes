const API_URL = "/api/admin";
const CHUNK_SIZE = 3 * 1024 * 1024;
const MAX_VIDEOS = 10;
const panels = ["setup-panel", "login-panel", "dashboard-panel"];
const notice = document.querySelector("#notice");
const uploadInput = document.querySelector("#video-file");
const selectedFile = document.querySelector("#selected-file");
const progress = document.querySelector("#upload-progress");
const uploadButton = document.querySelector('#upload-form button[type="submit"]');
let setupConfiguredNow = false;

function showNotice(message, kind = "error") {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  notice.hidden = false;
}

function clearNotice() {
  notice.textContent = "";
  notice.hidden = true;
}

function showPanel(id) {
  for (const panelId of panels) document.getElementById(panelId).hidden = panelId !== id;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function post(action, data = {}) {
  return requestJson(`${API_URL}?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function renderDashboard(videos, setupConfigured = false) {
  const list = Array.isArray(videos) ? videos : (videos ? [videos] : []);
  setupConfiguredNow = setupConfigured;
  showPanel("dashboard-panel");
  document.querySelector("#reset-access-button").hidden = !setupConfigured;
  const library = document.querySelector("#video-library");
  const listElement = document.querySelector("#video-list");
  const titleInput = document.querySelector("#video-title");
  const limitNote = document.querySelector("#video-limit-note");
  const atLimit = list.length >= MAX_VIDEOS;

  library.hidden = list.length === 0;
  document.querySelector("#video-count").textContent = `${list.length} / ${MAX_VIDEOS}`;
  limitNote.hidden = !atLimit;
  titleInput.disabled = atLimit;
  uploadInput.disabled = atLimit;
  uploadButton.disabled = atLimit;
  document.querySelector(".file-label").classList.toggle("disabled", atLimit);
  listElement.replaceChildren();

  for (const video of list) {
    const row = document.createElement("div");
    row.className = "video-list-item";
    const copy = document.createElement("div");
    copy.className = "video-list-copy";
    const title = document.createElement("strong");
    title.textContent = video.title || video.name;
    const detail = document.createElement("small");
    detail.textContent = `${video.name} · ${Math.max(1, Math.round(video.size / 1024 / 1024))} MB`;
    const remove = document.createElement("button");
    remove.className = "quiet-button danger";
    remove.type = "button";
    remove.dataset.removeVideo = video.id;
    remove.textContent = "Remover";
    copy.append(title, detail);
    row.append(copy, remove);
    listElement.append(row);
  }
}

async function initialize() {
  try {
    const status = await requestJson(`${API_URL}?action=status`);
    if (status.setupRequired) {
      showPanel("setup-panel");
      if (!status.setupConfigured) {
        showNotice("O codigo de verificacao ainda nao foi configurado no servidor. Peça ao desenvolvedor para configura-lo nas variaveis da Vercel.");
        document.querySelector('#setup-form button[type="submit"]').disabled = true;
      }
      return;
    }
    if (status.authenticated) renderDashboard(status.videos, status.setupConfigured);
    else showPanel("login-panel");
  } catch {
    showPanel("login-panel");
    showNotice("Nao foi possivel conectar ao servidor. Confirme se as funcoes da Vercel e o Blob Store privado foram configurados.");
  }
}

document.querySelector("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const password = String(form.get("password") || "");
  if (password !== String(form.get("confirmPassword") || "")) {
    showNotice("As senhas nao conferem.");
    return;
  }
  const button = formElement.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await post("setup", { setupKey: form.get("setupKey"), password });
    formElement.querySelectorAll("input").forEach((input) => { input.value = ""; });
    await initialize();
    showNotice("Senha criada e acesso iniciado.", "success");
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  const formElement = event.currentTarget;
  const button = formElement.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const form = new FormData(formElement);
    await post("login", { password: form.get("password") });
    formElement.querySelector('input[name="password"]').value = "";
    await initialize();
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await post("logout");
    window.location.reload();
  } catch (error) {
    showNotice(error.message);
  }
});

const resetDialog = document.querySelector("#reset-dialog");
const resetNotice = document.querySelector("#reset-notice");
document.querySelector("#reset-access-button").addEventListener("click", () => {
  resetNotice.hidden = true;
  document.querySelectorAll("#reset-form input").forEach((input) => { input.value = ""; });
  resetDialog.showModal();
});
document.querySelector("#cancel-reset").addEventListener("click", () => resetDialog.close());
document.querySelector("#reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  resetNotice.hidden = true;
  try {
    await post("reset-account", { password: form.get("password"), setupKey: form.get("setupKey") });
    resetDialog.close();
    window.location.reload();
  } catch (error) {
    resetNotice.textContent = error.message;
    resetNotice.hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#video-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-video]");
  if (!button) return;
  if (!window.confirm("Remover este video do carrossel?")) return;
  button.disabled = true;
  try {
    const result = await post("video-delete", { id: button.dataset.removeVideo });
    renderDashboard(result.videos, setupConfiguredNow);
    showNotice("Video removido do carrossel.", "success");
  } catch (error) {
    showNotice(error.message);
    button.disabled = false;
  }
});

uploadInput.addEventListener("change", () => {
  const file = uploadInput.files?.[0];
  selectedFile.hidden = !file;
  selectedFile.textContent = file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024 / 1024))} MB` : "";
});

document.querySelector("#upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const file = uploadInput.files?.[0];
  if (!file) return;
  const title = String(form.get("title") || "").trim();
  if (!title) {
    showNotice("Informe um titulo para este video.");
    return;
  }
  if (file.size > 300 * 1024 * 1024) {
    showNotice("O video excede o limite de 300 MB.");
    return;
  }

  uploadButton.disabled = true;
  progress.hidden = false;
  progress.value = 0;
  try {
    const init = await post("video-init", { title, name: file.name, type: file.type, size: file.size });
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    for (let index = 0; index < totalChunks; index += 1) {
      const chunk = file.slice(index * CHUNK_SIZE, Math.min(file.size, (index + 1) * CHUNK_SIZE));
      await requestJson(`${API_URL}?action=video-chunk&uploadId=${encodeURIComponent(init.uploadId)}&index=${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: chunk,
      });
      progress.value = Math.round(((index + 1) / totalChunks) * 100);
      showNotice(`Enviando video: ${progress.value}%`, "info");
    }
    const result = await post("video-complete", { uploadId: init.uploadId });
    uploadInput.value = "";
    document.querySelector("#video-title").value = "";
    selectedFile.hidden = true;
    progress.hidden = true;
    clearNotice();
    renderDashboard(result.videos, setupConfiguredNow);
    showNotice("Video adicionado ao carrossel do site.", "success");
  } catch (error) {
    showNotice(error.message);
  } finally {
    const uploadedCount = Number(document.querySelector("#video-count").textContent.split("/")[0].trim());
    uploadButton.disabled = uploadedCount >= MAX_VIDEOS;
  }
});

initialize();

