/* ═══════════════════════════════════════════════════════════
   YT Downloader — Frontend
   Uses SSE (EventSource) for live progress — no Socket.IO
   ═══════════════════════════════════════════════════════════ */

"use strict";

// ── State ──────────────────────────────────────────────────────
let jobs      = {};   // job_id → job object
let mediaType = "video";
let infoCache = null;

// ── SSE Connection ─────────────────────────────────────────────
let evtSource = null;

function connectSSE() {
  if (evtSource) evtSource.close();

  evtSource = new EventSource("/api/stream");

  evtSource.onopen = () => {
    setConn("online", "Connected");
  };

  evtSource.addEventListener("progress", (e) => {
    const data = JSON.parse(e.data);
    if (!data.id) return;

    const isNew = !jobs[data.id];
    jobs[data.id] = data;

    if (isNew) {
      appendItem(data);
    } else {
      renderItem(data);
    }
    updateStats();
  });

  evtSource.onerror = () => {
    setConn("offline", "Reconnecting…");
    // Browser auto-reconnects EventSource — we just update the label
    setTimeout(() => {
      if (evtSource.readyState === EventSource.CLOSED) {
        connectSSE();
      }
    }, 3000);
  };
}

connectSSE();

function setConn(state, label) {
  document.getElementById("conn-dot").className  = `conn-dot ${state}`;
  document.getElementById("conn-label").textContent = label;
}

// ── Navigation ─────────────────────────────────────────────────
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

// ── URL helpers ────────────────────────────────────────────────
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

// ── Fetch Info ─────────────────────────────────────────────────
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
  document.getElementById("infoPreview").classList.remove("hidden");
  document.getElementById("infoThumb").src       = info.thumbnail || "";
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

  const qDiv = document.getElementById("infoQualities");
  qDiv.innerHTML = "";
  (info.available_qualities || []).forEach(q => {
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

// ── Add Download ───────────────────────────────────────────────
async function addDownload() {
  const url = document.getElementById("urlInput").value.trim();
  if (!url) { toast("Paste a YouTube URL first", "error"); return; }

  const quality   = document.getElementById("qualSel").value;
  const subtitles = document.getElementById("chkSubs").checked;
  const thumbnail = document.getElementById("chkThumb").checked;

  if (infoCache && infoCache.type === "playlist" && infoCache.entries?.length) {
    const total = infoCache.entries.length;
    for (let i = 0; i < total; i++) {
      const entry = infoCache.entries[i];
      await queueJob({
        url:            entry.url,
        title:          entry.title,
        quality, subtitles, thumbnail,
        duration:       entry.duration,
        thumbnail_url:  infoCache.thumbnail,
        playlist_index: i + 1,
        playlist_total: total,
      });
    }
    toast(`Queued ${total} videos`, "success");
  } else {
    await queueJob({
      url,
      title:         infoCache?.title || url,
      quality, subtitles, thumbnail,
      thumbnail_url: infoCache?.thumbnail || "",
    });
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
    // SSE will push the job state back — no need to manually track here
  } catch (err) {
    toast("Error: " + err.message, "error");
  }
}

function downloadAll() {
  toast("All queued jobs are running", "success");
}

// ── Render ─────────────────────────────────────────────────────
function showQueue() {
  const count = Object.keys(jobs).length;
  document.getElementById("emptyState").style.display = count ? "none" : "block";
  document.getElementById("dlAllBtn").disabled = count === 0;
}

function appendItem(job) {
  document.getElementById("emptyState").style.display = "none";
  document.getElementById("dlAllBtn").disabled = false;

  // Don't duplicate
  if (document.getElementById(`item-${job.id}`)) {
    renderItem(job);
    return;
  }

  const el = document.createElement("div");
  el.id = `item-${job.id}`;
  el.className = "item";
  document.getElementById("queue").prepend(el);
  renderItem(job);
  updateQueueCount();
}

function renderItem(job) {
  const el = document.getElementById(`item-${job.id}`);
  if (!el) return;

  const pct   = job.progress || 0;
  const st    = job.status || "queued";

  el.className = `item ${st === "downloading" ? "downloading" : st === "done" ? "done" : st === "error" ? "error" : ""}`;

  const LABELS = {
    queued: "Queued", fetching: "Fetching…", downloading: "Downloading",
    processing: "Merging…", done: "Complete", error: "Error",
  };
  const BADGE = {
    queued: "badge-queue", fetching: "badge-fetching",
    downloading: "badge-downloading", processing: "badge-processing",
    done: "badge-done", error: "badge-error",
  };

  const icon =
    (st === "downloading" || st === "fetching" || st === "processing")
      ? `<span class="spinner"></span>`
      : st === "done"
      ? `<i class="ti ti-check" style="color:var(--green);font-size:13px"></i>`
      : st === "error"
      ? `<i class="ti ti-alert-circle" style="color:var(--red);font-size:13px"></i>`
      : `<i class="ti ti-clock" style="font-size:13px;color:var(--txt3)"></i>`;

  const thumbHtml = job.thumbnail_url
    ? `<div class="item-thumb"><img src="${escHtml(job.thumbnail_url)}" alt="" loading="lazy"/></div>`
    : `<div class="item-thumb"><i class="ti ti-video"></i></div>`;

  const durationChip = job.duration
    ? `<span class="meta-chip"><i class="ti ti-clock"></i> ${fmtDuration(job.duration)}</span>`
    : "";

  const fmtChip = job.type === "audio"
    ? `<span class="meta-chip"><i class="ti ti-music"></i> MP3</span>`
    : `<span class="meta-chip"><i class="ti ti-video"></i> MP4 ${job.quality || "1080"}p</span>`;

  // Only show progress bar once downloading starts
  const showBar = st !== "queued";

  const progressHtml = showBar ? `
    <div class="progress-wrap">
      <div class="progress-meta">
        <div class="progress-left">
          ${icon}
          <span class="badge ${BADGE[st] || "badge-queue"}">${LABELS[st] || st}</span>
          ${job.speed ? `<span class="speed-chip">${escHtml(job.speed)}</span>` : ""}
        </div>
        <div class="progress-right">
          ${job.eta  ? `<span class="eta-chip">${escHtml(job.eta)}</span>` : ""}
          <span class="pct-chip">${pct}%</span>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${st === "done" ? "done" : st === "error" ? "error" : ""}"
             style="width:${pct}%"></div>
      </div>
      ${st === "error" && job.error
        ? `<div class="error-msg"><i class="ti ti-alert-triangle"></i> ${escHtml(job.error)}</div>`
        : ""}
    </div>` : "";

  const openBtn = st === "done"
    ? `<button class="icon-btn" title="Saved to ./downloads/" onclick="toast('Saved to ./downloads/ folder')">
         <i class="ti ti-folder-open"></i></button>` : "";

  // Playlist number badge shown in the queue card
  const numBadge = job.playlist_index != null && job.playlist_total != null
    ? `<span class="num-badge">${String(job.playlist_index).padStart(String(job.playlist_total).length, "0")}/${job.playlist_total}</span>`
    : "";

  el.innerHTML = `
    <div class="item-top">
      ${thumbHtml}
      <div class="item-info">
        <div class="item-title" title="${escHtml(job.title)}">${numBadge}${escHtml(job.title)}</div>
        <div class="item-meta">
          ${durationChip}
          ${fmtChip}
        </div>
      </div>
      <div class="item-actions">
        ${openBtn}
        <button class="icon-btn danger" title="Remove" onclick="removeJob('${job.id}')">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    </div>
    ${progressHtml}`;
}

async function removeJob(id) {
  delete jobs[id];
  document.getElementById(`item-${id}`)?.remove();
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

// ── Stats ──────────────────────────────────────────────────────
function updateStats() {
  const all    = Object.values(jobs);
  const done   = all.filter(j => j.status === "done").length;
  const active = all.filter(j =>
    ["downloading","fetching","processing"].includes(j.status)).length;

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

// ── Files View ─────────────────────────────────────────────────
async function loadFiles() {
  const container = document.getElementById("filesList");
  container.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--txt3)"><span class="spinner"></span></div>`;

  try {
    const res   = await fetch("/api/files");
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
      </div>`).join("");
  } catch {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-alert-circle"></i><p>Failed to load</p></div>`;
  }
}

// ── Settings ───────────────────────────────────────────────────
function saveSettings() {
  document.getElementById("qualSel").value = document.getElementById("defaultQual").value;
  toast("Settings saved");
}

// ── Utils ──────────────────────────────────────────────────────
function fmtDuration(s) {
  if (!s) return "";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h
    ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
    : `${m}:${String(sec).padStart(2,"0")}`;
}

function fmtNumber(n) {
  return n >= 1e6 ? (n/1e6).toFixed(1)+"M" : n >= 1e3 ? (n/1e3).toFixed(1)+"K" : String(n);
}

function fmtSize(b) {
  return b >= 1073741824 ? (b/1073741824).toFixed(2)+" GB"
       : b >= 1048576    ? (b/1048576).toFixed(1)+" MB"
       : b >= 1024       ? (b/1024).toFixed(0)+" KB"
       : b+" B";
}

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

let _toastTimer;
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}

// ── Keyboard & paste shortcuts ─────────────────────────────────
document.getElementById("urlInput").addEventListener("keydown", e => {
  if (e.key === "Enter") addDownload();
});

document.getElementById("urlInput").addEventListener("paste", () => {
  setTimeout(() => {
    const url = document.getElementById("urlInput").value.trim();
    if (url.includes("youtube.com") || url.includes("youtu.be")) fetchInfo();
  }, 60);
});
