/* ═══════════════════════════════════════════════════════════
   YT Downloader — Frontend App
   Connects to Flask backend via REST + Socket.IO
   ═══════════════════════════════════════════════════════════ */

"use strict";

// ── State ─────────────────────────────────────────────────────
let jobs        = {};   // job_id → job object
let mediaType   = "video";
let infoCache   = null; // last fetched info

// ── Socket.IO ─────────────────────────────────────────────────
const socket = io({ transports: ["websocket", "polling"] });

socket.on("connect", () => {
  setConn("online", "Connected");
});

socket.on("disconnect", () => {
  setConn("offline", "Disconnected");
});

socket.on("connect_error", () => {
  setConn("error", "Connection error");
});

socket.on("progress", (data) => {
  if (!data.job_id) return;
  const job = jobs[data.job_id];
  if (!job) return;

  Object.assign(job, data);
  renderItem(job);
  updateStats();
});

function setConn(state, label) {
  const dot   = document.getElementById("conn-dot");
  const lbl   = document.getElementById("conn-label");
  dot.className = `conn-dot ${state}`;
  lbl.textContent = label;
}

// ── Navigation ────────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", e => {
    e.preventDefault();
    const view = el.dataset.view;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    el.classList.add("active");
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById(`view-${view}`).classList.add("active");
    if (view === "files") loadFiles();
  });
});

// ── URL helpers ───────────────────────────────────────────────
function clearUrl() {
  document.getElementById("urlInput").value = "";
  hideInfoPreview();
  infoCache = null;
}

function setType(t) {
  mediaType = t;
  document.getElementById("togVideo").classList.toggle("active", t === "video");
  document.getElementById("togAudio").classList.toggle("active", t === "audio");
  document.getElementById("qualGroup").style.display = t === "audio" ? "none" : "";
}

function hideInfoPreview() {
  document.getElementById("infoPreview").classList.add("hidden");
}

// ── Fetch Info ────────────────────────────────────────────────
async function fetchInfo() {
  const url = document.getElementById("urlInput").value.trim();
  if (!url) { toast("Paste a URL first", "error"); return; }

  const btn = document.getElementById("infoBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Fetching…`;

  try {
    const res  = await fetch("/api/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.error) { toast(data.error, "error"); return; }

    infoCache = data;
    showInfoPreview(data);
  } catch (err) {
    toast("Failed to fetch info: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="ti ti-info-circle"></i> Info`;
  }
}

function showInfoPreview(info) {
  const wrap = document.getElementById("infoPreview");
  wrap.classList.remove("hidden");

  document.getElementById("infoThumb").src = info.thumbnail || "";
  document.getElementById("infoTitle").textContent = info.title || "";
  document.getElementById("infoUploader").textContent = info.uploader || "";
  document.getElementById("infoDuration").textContent =
    info.duration ? `⏱ ${fmtDuration(info.duration)}` : "";
  document.getElementById("infoViews").textContent =
    info.view_count ? `👁 ${fmtNumber(info.view_count)}` : "";

  const countEl = document.getElementById("infoCount");
  if (info.type === "playlist") {
    countEl.textContent = `${info.count} videos`;
    countEl.style.display = "inline";
  } else {
    countEl.style.display = "none";
  }

  // Quality chips
  const qDiv = document.getElementById("infoQualities");
  qDiv.innerHTML = "";
  const quals = info.available_qualities || [];
  quals.forEach(q => {
    const chip = document.createElement("span");
    chip.className = "q-chip";
    chip.textContent = `${q}p`;
    chip.onclick = () => {
      document.querySelectorAll(".q-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      document.getElementById("qualSel").value = String(q);
    };
    qDiv.appendChild(chip);
  });
}

// ── Add Download ──────────────────────────────────────────────
async function addDownload() {
  const url = document.getElementById("urlInput").value.trim();
  if (!url) { toast("Paste a YouTube URL first", "error"); return; }

  const quality   = document.getElementById("qualSel").value;
  const subtitles = document.getElementById("chkSubs").checked;
  const thumbnail = document.getElementById("chkThumb").checked;
  const isPlaylist = url.includes("list=") || url.includes("playlist");

  // If playlist info cached, queue each entry individually
  if (infoCache && infoCache.type === "playlist" && infoCache.entries?.length) {
    for (const entry of infoCache.entries) {
      await queueJob({
        url:        entry.url,
        title:      entry.title,
        quality,
        type:       mediaType,
        subtitles,
        thumbnail,
        is_playlist: false,
        duration:   entry.duration,
        thumbnail_url: infoCache.thumbnail,
      });
    }
    toast(`Queued ${infoCache.entries.length} videos`, "success");
  } else {
    const title = infoCache?.title || url;
    const thumb = infoCache?.thumbnail || "";
    await queueJob({ url, title, quality, type: mediaType, subtitles, thumbnail, is_playlist: isPlaylist, thumbnail_url: thumb });
    toast("Added to queue");
  }

  clearUrl();
  showQueue();
}

async function queueJob(params) {
  try {
    const res  = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (data.error) { toast(data.error, "error"); return; }

    const job = {
      id:           data.job_id,
      url:          params.url,
      title:        params.title || params.url,
      quality:      params.quality || "1080",
      type:         params.type || "video",
      status:       "queued",
      progress:     0,
      speed:        "",
      eta:          "",
      thumbnail_url: params.thumbnail_url || "",
      duration:     params.duration || null,
    };

    jobs[data.job_id] = job;
    appendItem(job);
    updateStats();
    document.getElementById("dlAllBtn").disabled = false;
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
}

// ── Download All ──────────────────────────────────────────────
function downloadAll() {
  // Backend already starts downloads automatically; this is a no-op
  // but you could batch-start paused jobs here
  toast("All queued jobs are running", "success");
}

// ── Render Queue Items ────────────────────────────────────────
function showQueue() {
  document.getElementById("emptyState").style.display = Object.keys(jobs).length ? "none" : "block";
}

function appendItem(job) {
  document.getElementById("emptyState").style.display = "none";
  const el = document.createElement("div");
  el.className = "item";
  el.id = `item-${job.id}`;
  document.getElementById("queue").prepend(el);
  renderItem(job);
  updateQueueCount();
}

function renderItem(job) {
  const el = document.getElementById(`item-${job.id}`);
  if (!el) return;

  el.className = `item ${job.status === "downloading" ? "downloading" : job.status === "done" ? "done" : job.status === "error" ? "error" : ""}`;

  const pct     = job.progress || 0;
  const fillCls = job.status === "done" ? "done" : job.status === "error" ? "error" : "";
  const badgeCls = `badge-${job.status || "queue"}`;

  const badgeLabel = {
    queued:      "Queued",
    fetching:    "Fetching…",
    downloading: "Downloading",
    processing:  "Processing…",
    done:        "Complete",
    error:       "Error",
  }[job.status] || "Queued";

  const spinnerOrIcon =
    job.status === "downloading" || job.status === "fetching" || job.status === "processing"
      ? `<span class="spinner"></span>`
      : job.status === "done"
      ? `<i class="ti ti-check" style="color:var(--green);font-size:13px"></i>`
      : job.status === "error"
      ? `<i class="ti ti-alert-circle" style="color:var(--red);font-size:13px"></i>`
      : `<i class="ti ti-clock" style="font-size:13px;color:var(--txt3)"></i>`;

  const thumbHtml = job.thumbnail_url
    ? `<div class="item-thumb"><img src="${escHtml(job.thumbnail_url)}" alt="" loading="lazy" /></div>`
    : `<div class="item-thumb"><i class="ti ti-video"></i></div>`;

  const durationChip = job.duration
    ? `<span class="meta-chip"><i class="ti ti-clock"></i> ${fmtDuration(job.duration)}</span>`
    : "";

  const formatChip = job.type === "audio"
    ? `<span class="meta-chip"><i class="ti ti-music"></i> MP3</span>`
    : `<span class="meta-chip"><i class="ti ti-video"></i> MP4 ${job.quality}p</span>`;

  const errorMsg = job.status === "error" && job.error
    ? `<div style="font-size:12px;color:var(--red-text);margin-top:6px"><i class="ti ti-alert-triangle"></i> ${escHtml(job.error)}</div>`
    : "";

  const progressHtml = job.status !== "queued" ? `
    <div class="progress-wrap">
      <div class="progress-meta">
        <div class="progress-left">
          ${spinnerOrIcon}
          <span class="badge ${badgeCls}">${badgeLabel}</span>
          ${job.speed ? `<span style="font-size:11px;color:var(--txt2)">${escHtml(job.speed)}</span>` : ""}
        </div>
        <div class="progress-right">
          ${job.eta ? `<span>ETA ${escHtml(job.eta)}</span>` : ""}
          <span>${pct}%</span>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${fillCls}" style="width:${pct}%"></div>
      </div>
      ${errorMsg}
    </div>` : "";

  const openBtn = job.status === "done"
    ? `<button class="icon-btn" title="Open folder" onclick="toast('File saved to ./downloads/')">
         <i class="ti ti-folder-open"></i>
       </button>`
    : "";

  el.innerHTML = `
    <div class="item-top">
      ${thumbHtml}
      <div class="item-info">
        <div class="item-title" title="${escHtml(job.title)}">${escHtml(job.title)}</div>
        <div class="item-meta">
          ${durationChip}
          ${formatChip}
          <span class="meta-chip"><i class="ti ti-id"></i> ${escHtml(job.id.slice(0,8))}</span>
        </div>
      </div>
      <div class="item-actions">
        ${openBtn}
        <button class="icon-btn danger" title="Remove" onclick="removeJob('${job.id}')">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    </div>
    ${progressHtml}
  `;
}

async function removeJob(id) {
  delete jobs[id];
  const el = document.getElementById(`item-${id}`);
  if (el) el.remove();
  updateStats();
  updateQueueCount();
  if (!Object.keys(jobs).length) {
    document.getElementById("emptyState").style.display = "block";
    document.getElementById("dlAllBtn").disabled = true;
  }
  await fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => {});
}

function clearDone() {
  Object.keys(jobs).forEach(id => {
    if (jobs[id].status === "done") removeJob(id);
  });
}

// ── Stats ─────────────────────────────────────────────────────
function updateStats() {
  const all    = Object.values(jobs);
  const done   = all.filter(j => j.status === "done").length;
  const active = all.filter(j => j.status === "downloading" || j.status === "fetching" || j.status === "processing").length;

  document.getElementById("ss-total").textContent  = all.length;
  document.getElementById("ss-done").textContent   = done;
  document.getElementById("ss-active").textContent = active;
  updateQueueCount();
}

function updateQueueCount() {
  const count = Object.keys(jobs).length;
  document.getElementById("queueCount").textContent = count;
  document.getElementById("dlAllBtn").disabled = count === 0;
}

// ── Files View ────────────────────────────────────────────────
async function loadFiles() {
  const container = document.getElementById("filesList");
  container.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3)"><span class="spinner"></span></div>`;

  try {
    const res  = await fetch("/api/files");
    const files = await res.json();

    if (!files.length) {
      container.innerHTML = `<div class="empty-state"><i class="ti ti-folder-open"></i><p>No files yet</p></div>`;
      return;
    }

    container.innerHTML = files.map(f => `
      <div class="file-item">
        <i class="ti ${f.name.endsWith(".mp3") ? "ti-music" : "ti-video"} file-icon"></i>
        <div class="file-info">
          <div class="file-name" title="${escHtml(f.name)}">${escHtml(f.name)}</div>
          <div class="file-size">${fmtSize(f.size)}</div>
        </div>
        <a class="btn btn-ghost btn-sm" href="${f.url}" download>
          <i class="ti ti-download"></i> Save
        </a>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Failed to load files</p></div>`;
  }
}

// ── Settings ──────────────────────────────────────────────────
function saveSettings() {
  const q = document.getElementById("defaultQual").value;
  document.getElementById("qualSel").value = q;
  toast("Settings saved");
}

// ── Utilities ─────────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function fmtNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function fmtSize(bytes) {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + " GB";
  if (bytes >= 1_048_576)     return (bytes / 1_048_576).toFixed(1) + " MB";
  if (bytes >= 1_024)         return (bytes / 1_024).toFixed(0) + " KB";
  return bytes + " B";
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer;
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

// ── Enter key on URL input ────────────────────────────────────
document.getElementById("urlInput").addEventListener("keydown", e => {
  if (e.key === "Enter") addDownload();
});

// Paste auto-fetch info
document.getElementById("urlInput").addEventListener("paste", () => {
  setTimeout(() => {
    const url = document.getElementById("urlInput").value.trim();
    if (url.includes("youtube.com") || url.includes("youtu.be")) fetchInfo();
  }, 50);
});
