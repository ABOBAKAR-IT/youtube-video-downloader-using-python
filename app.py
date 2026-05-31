"""
YouTube Video & Playlist Downloader
Backend: Flask + yt-dlp + SSE (Server-Sent Events) for live progress
Run: python app.py
"""

import os
import re
import uuid
import threading
import queue
import json
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_from_directory, Response, stream_with_context
import yt_dlp

# ── App setup ─────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent
DOWNLOAD_DIR = BASE_DIR / "downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.config["SECRET_KEY"] = "yt-dl-secret-key"

# ── Concurrency control ────────────────────────────────────────
# User can change via /api/settings. Default = 2.
_concurrent_limit = 2
_semaphore        = threading.Semaphore(_concurrent_limit)
_semaphore_lock   = threading.Lock()

def set_concurrent(n: int):
    """Replace the global semaphore with a new one (safe between jobs)."""
    global _semaphore, _concurrent_limit
    n = max(1, min(5, n))
    with _semaphore_lock:
        _concurrent_limit = n
        _semaphore = threading.Semaphore(n)

# ── Jobs & SSE subscribers ─────────────────────────────────────
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()

subscribers: list[queue.Queue] = []
subscribers_lock = threading.Lock()


# ── SSE broadcast ──────────────────────────────────────────────
def broadcast(event: str, data: dict):
    msg = f"event: {event}\ndata: {json.dumps(data)}\n\n"
    with subscribers_lock:
        dead = []
        for q in subscribers:
            try:
                q.put_nowait(msg)
            except queue.Full:
                dead.append(q)
        for q in dead:
            subscribers.remove(q)


@app.route("/api/stream")
def sse_stream():
    q = queue.Queue(maxsize=200)
    with subscribers_lock:
        subscribers.append(q)

    def generate():
        # Send current state + settings on connect
        with jobs_lock:
            current = list(jobs.values())
        for job in current:
            yield f"event: progress\ndata: {json.dumps(job)}\n\n"
        yield f"event: settings\ndata: {json.dumps({'concurrent': _concurrent_limit})}\n\n"

        try:
            while True:
                try:
                    msg = q.get(timeout=20)
                    yield msg
                except queue.Empty:
                    yield ": heartbeat\n\n"
        except GeneratorExit:
            pass
        finally:
            with subscribers_lock:
                try:
                    subscribers.remove(q)
                except ValueError:
                    pass

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering":"no",
            "Connection":       "keep-alive",
        },
    )


# ── Settings API ───────────────────────────────────────────────
@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify({"concurrent": _concurrent_limit})


@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.get_json(force=True)
    n    = int(data.get("concurrent", _concurrent_limit))
    set_concurrent(n)
    broadcast("settings", {"concurrent": _concurrent_limit})
    return jsonify({"ok": True, "concurrent": _concurrent_limit})


# ── Download logic ─────────────────────────────────────────────
def build_ydl_opts(job: dict) -> dict:
    quality        = job.get("quality", "1080")
    dl_type        = job.get("type", "video")
    subs           = job.get("subtitles", False)
    thumbnail      = job.get("thumbnail", False)
    job_id         = job["id"]
    playlist_index = job.get("playlist_index")
    playlist_total = job.get("playlist_total")

    # Numbered prefix: "01 - ", "02 - " etc.
    if playlist_index is not None and playlist_total is not None:
        pad    = len(str(playlist_total))
        prefix = str(playlist_index).zfill(pad) + " - "
    else:
        prefix = ""

    out_tmpl = str(DOWNLOAD_DIR / f"{prefix}%(title)s [%(id)s].%(ext)s")

    if dl_type == "audio":
        fmt = "bestaudio/best"
        postprocessors = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"},
        ]
    else:
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
        update = {}

        if status == "downloading":
            total      = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            pct        = int(downloaded / total * 100) if total else 0
            speed      = d.get("speed") or 0
            eta        = d.get("eta") or 0
            update = {
                "status":   "downloading",
                "progress": pct,
                "speed":    f"{speed / 1_048_576:.1f} MB/s" if speed else "—",
                "eta":      f"{eta}s" if eta < 60 else f"{eta // 60}m {eta % 60}s",
            }
        elif status == "finished":
            update = {"status": "processing", "progress": 99, "speed": "", "eta": "Merging…"}
        elif status == "error":
            update = {"status": "error", "progress": 0, "error": str(d.get("error", "Unknown"))}

        if update:
            with jobs_lock:
                if job_id in jobs:
                    jobs[job_id].update(update)
                    payload = dict(jobs[job_id])
            broadcast("progress", payload)

    opts = {
        "format":              fmt,
        "outtmpl":             out_tmpl,
        "progress_hooks":      [progress_hook],
        "postprocessors":      postprocessors,
        "merge_output_format": "mp4" if dl_type == "video" else None,
        "noplaylist":          True,
        "quiet":               True,
        "no_warnings":         True,
        "ignoreerrors":        True,
        "noprogress":          False,
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
    """Runs in a background thread. Waits for semaphore slot before starting."""
    # Show as "waiting" if all slots are busy
    with jobs_lock:
        if jobs.get(job_id, {}).get("status") == "queued":
            jobs[job_id]["status"] = "waiting"
            payload = dict(jobs[job_id])
    broadcast("progress", payload)

    with _semaphore:   # ← blocks until a slot is free
        with jobs_lock:
            if job_id not in jobs:
                return   # was deleted while waiting
            job = dict(jobs[job_id])
            jobs[job_id]["status"]   = "downloading"
            jobs[job_id]["progress"] = 0
            payload = dict(jobs[job_id])
        broadcast("progress", payload)

        try:
            opts = build_ydl_opts(job)
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([job["url"]])

            # Find the saved filename to attach a download URL
            saved_file = _find_saved_file(job_id, job)

            with jobs_lock:
                jobs[job_id].update({
                    "status":    "done",
                    "progress":  100,
                    "speed":     "",
                    "eta":       "",
                    "file_url":  f"/downloads/{saved_file}" if saved_file else "",
                    "file_name": saved_file or "",
                })
                payload = dict(jobs[job_id])
            broadcast("progress", payload)

        except Exception as exc:
            err = str(exc)
            with jobs_lock:
                jobs[job_id].update({"status": "error", "error": err, "progress": 0})
                payload = dict(jobs[job_id])
            broadcast("progress", payload)


def _find_saved_file(job_id: str, job: dict) -> str:
    """
    After yt-dlp finishes, find the file it saved so we can give the user
    a direct download link. We match by scanning the downloads folder for
    files modified in the last 5 minutes that contain the video ID.
    """
    import time
    now = time.time()
    video_id = job.get("url", "").split("v=")[-1].split("&")[0][:11]

    best = None
    for f in DOWNLOAD_DIR.iterdir():
        if not f.is_file():
            continue
        # Modified within last 5 min
        if now - f.stat().st_mtime > 300:
            continue
        # Matches video ID or recent file (fallback)
        if video_id and video_id in f.name:
            return f.name
        if best is None or f.stat().st_mtime > best.stat().st_mtime:
            best = f

    return best.name if best else ""


# ── REST API ───────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/info", methods=["POST"])
def get_info():
    data = request.get_json(force=True)
    url  = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    try:
        opts = {
            "quiet": True, "no_warnings": True,
            "extract_flat": "in_playlist", "skip_download": True,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not info:
            return jsonify({"error": "Could not fetch info"}), 400

        if info.get("_type") == "playlist" or "entries" in info:
            entries = info.get("entries") or []
            return jsonify({
                "type":      "playlist",
                "title":     info.get("title", "Playlist"),
                "count":     len(entries),
                "uploader":  info.get("uploader", ""),
                "thumbnail": info.get("thumbnail", ""),
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

        fmts    = info.get("formats") or []
        heights = sorted(
            {f["height"] for f in fmts if f.get("height") and f.get("vcodec") != "none"},
            reverse=True,
        )
        return jsonify({
            "type":                "video",
            "id":                  info.get("id", ""),
            "title":               info.get("title", ""),
            "duration":            info.get("duration"),
            "uploader":            info.get("uploader", ""),
            "view_count":          info.get("view_count"),
            "thumbnail":           info.get("thumbnail", ""),
            "available_qualities": heights or [1080, 720, 480, 360],
        })

    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/download", methods=["POST"])
def start_download():
    data = request.get_json(force=True)
    url  = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    job_id         = str(uuid.uuid4())
    playlist_index = data.get("playlist_index")
    playlist_total = data.get("playlist_total")

    job = {
        "id":             job_id,
        "url":            url,
        "title":          data.get("title", url),
        "quality":        str(data.get("quality", "1080")),
        "type":           data.get("type", "video"),
        "subtitles":      bool(data.get("subtitles", False)),
        "thumbnail":      bool(data.get("thumbnail", False)),
        "status":         "queued",
        "progress":       0,
        "speed":          "",
        "eta":            "",
        "error":          "",
        "file_url":       "",
        "file_name":      "",
        "thumbnail_url":  data.get("thumbnail_url", ""),
        "duration":       data.get("duration"),
        "playlist_index": int(playlist_index) if playlist_index is not None else None,
        "playlist_total": int(playlist_total) if playlist_total is not None else None,
    }

    with jobs_lock:
        jobs[job_id] = job

    broadcast("progress", job)

    t = threading.Thread(target=run_download, args=(job_id,), daemon=True)
    t.start()

    return jsonify({"job_id": job_id, "status": "queued"})


@app.route("/api/jobs", methods=["GET"])
def list_jobs():
    with jobs_lock:
        return jsonify(list(jobs.values()))


@app.route("/api/jobs/<job_id>", methods=["DELETE"])
def delete_job(job_id):
    with jobs_lock:
        jobs.pop(job_id, None)
    return jsonify({"ok": True})


@app.route("/downloads/<path:filename>")
def serve_download(filename):
    """Serve file to user's browser as a download (works from remote server too)."""
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


# ── Entry point ────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7000))
    print(f"\n🎬  YT Downloader  →  http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
