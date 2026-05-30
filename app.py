"""
YouTube Video & Playlist Downloader
Backend: Flask + yt-dlp + Flask-SocketIO
Run: python app.py
"""

import os
import re
import uuid
import threading
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit
import yt_dlp

# ── App setup ────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
DOWNLOAD_DIR = BASE_DIR / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

app    = Flask(__name__)
app.config["SECRET_KEY"] = "yt-dl-secret-key"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Active download jobs: job_id → {"status", "progress", "speed", "eta", ...}
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


# ── Helpers ──────────────────────────────────────────────────────────────────
def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "_", name)


def build_ydl_opts(job: dict) -> dict:
    quality   = job.get("quality", "1080")
    dl_type   = job.get("type", "video")       # "video" | "audio"
    subs      = job.get("subtitles", False)
    thumbnail = job.get("thumbnail", False)
    job_id    = job["id"]

    out_tmpl = str(DOWNLOAD_DIR / "%(title)s [%(id)s].%(ext)s")

    if dl_type == "audio":
        fmt = "bestaudio/best"
        postprocessors = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"},
        ]
    else:
        # Prefer up to chosen quality; fallback gracefully
        fmt = (
            f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]"
            f"/bestvideo[height<={quality}]+bestaudio"
            f"/best[height<={quality}]/best"
        )
        postprocessors = [
            {"key": "FFmpegVideoConvertor", "preferedformat": "mp4"},
        ]

    if thumbnail:
        postprocessors.append({"key": "EmbedThumbnail"})

    def progress_hook(d):
        status = d.get("status")
        with jobs_lock:
            if job_id not in jobs:
                return
            j = jobs[job_id]

        update = {}

        if status == "downloading":
            total   = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            pct     = int(downloaded / total * 100) if total else 0
            speed   = d.get("speed") or 0
            eta     = d.get("eta") or 0

            update = {
                "status":   "downloading",
                "progress": pct,
                "speed":    f"{speed / 1_048_576:.1f} MB/s" if speed else "—",
                "eta":      f"{eta}s" if eta < 60 else f"{eta // 60}m {eta % 60}s",
                "filename": d.get("filename", ""),
            }

        elif status == "finished":
            update = {
                "status":   "processing",
                "progress": 99,
                "speed":    "",
                "eta":      "",
            }

        elif status == "error":
            update = {"status": "error", "progress": 0, "error": str(d.get("error", "Unknown error"))}

        with jobs_lock:
            jobs[job_id].update(update)

        socketio.emit("progress", {"job_id": job_id, **update})

    opts = {
        "format":           fmt,
        "outtmpl":          out_tmpl,
        "progress_hooks":   [progress_hook],
        "postprocessors":   postprocessors,
        "merge_output_format": "mp4" if dl_type == "video" else None,
        "noplaylist":       not job.get("is_playlist", False),
        "quiet":            True,
        "no_warnings":      True,
        "ignoreerrors":     True,
    }

    if subs:
        opts.update({
            "writesubtitles":    True,
            "writeautomaticsub": True,
            "subtitleslangs":    ["en"],
        })

    if thumbnail:
        opts["writethumbnail"] = True

    return opts


def run_download(job_id: str):
    with jobs_lock:
        job = dict(jobs[job_id])

    url = job["url"]
    opts = build_ydl_opts(job)

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        with jobs_lock:
            jobs[job_id].update({"status": "done", "progress": 100, "speed": "", "eta": ""})

        socketio.emit("progress", {"job_id": job_id, "status": "done", "progress": 100})

    except Exception as exc:
        err = str(exc)
        with jobs_lock:
            jobs[job_id].update({"status": "error", "error": err})
        socketio.emit("progress", {"job_id": job_id, "status": "error", "error": err})


# ── REST API ──────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/info", methods=["POST"])
def get_info():
    """Fetch video / playlist metadata without downloading."""
    data = request.get_json(force=True)
    url  = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": "in_playlist",   # fast playlist scan
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not info:
            return jsonify({"error": "Could not fetch info"}), 400

        # Playlist
        if info.get("_type") == "playlist" or "entries" in info:
            entries = info.get("entries") or []
            return jsonify({
                "type":       "playlist",
                "title":      info.get("title", "Playlist"),
                "count":      len(entries),
                "uploader":   info.get("uploader", ""),
                "thumbnail":  info.get("thumbnail", ""),
                "entries": [
                    {
                        "id":       e.get("id", ""),
                        "title":    e.get("title", f"Video {i+1}"),
                        "duration": e.get("duration"),
                        "url":      e.get("url") or f"https://www.youtube.com/watch?v={e.get('id','')}",
                    }
                    for i, e in enumerate(entries) if e
                ],
            })

        # Single video
        fmts = info.get("formats") or []
        heights = sorted(
            {f["height"] for f in fmts if f.get("height") and f.get("vcodec") != "none"},
            reverse=True,
        )
        return jsonify({
            "type":        "video",
            "id":          info.get("id", ""),
            "title":       info.get("title", ""),
            "duration":    info.get("duration"),
            "uploader":    info.get("uploader", ""),
            "view_count":  info.get("view_count"),
            "thumbnail":   info.get("thumbnail", ""),
            "available_qualities": heights or [1080, 720, 480, 360],
        })

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/download", methods=["POST"])
def start_download():
    """Queue one download job."""
    data   = request.get_json(force=True)
    url    = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    job_id = str(uuid.uuid4())
    job    = {
        "id":          job_id,
        "url":         url,
        "title":       data.get("title", url),
        "quality":     str(data.get("quality", "1080")),
        "type":        data.get("type", "video"),
        "subtitles":   bool(data.get("subtitles", False)),
        "thumbnail":   bool(data.get("thumbnail", False)),
        "is_playlist": bool(data.get("is_playlist", False)),
        "status":      "queued",
        "progress":    0,
        "speed":       "",
        "eta":         "",
        "error":       "",
    }

    with jobs_lock:
        jobs[job_id] = job

    # Run in background thread
    t = threading.Thread(target=run_download, args=(job_id,), daemon=True)
    t.start()

    return jsonify({"job_id": job_id, "status": "queued"})


@app.route("/api/jobs", methods=["GET"])
def list_jobs():
    with jobs_lock:
        return jsonify(list(jobs.values()))


@app.route("/api/jobs/<job_id>", methods=["GET"])
def get_job(job_id):
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "Not found"}), 404
    return jsonify(job)


@app.route("/api/jobs/<job_id>", methods=["DELETE"])
def delete_job(job_id):
    with jobs_lock:
        jobs.pop(job_id, None)
    return jsonify({"ok": True})


@app.route("/downloads/<path:filename>")
def serve_download(filename):
    return send_from_directory(DOWNLOAD_DIR, filename, as_attachment=True)


@app.route("/api/files", methods=["GET"])
def list_files():
    files = []
    for f in DOWNLOAD_DIR.iterdir():
        if f.is_file():
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "url":  f"/downloads/{f.name}",
            })
    files.sort(key=lambda x: x["name"])
    return jsonify(files)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n🎬  YT Downloader running at http://localhost:7000\n")
    socketio.run(app, host="0.0.0.0", port=7000, debug=False)
