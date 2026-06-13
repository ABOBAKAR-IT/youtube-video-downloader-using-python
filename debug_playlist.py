"""
Quick debug script — paste your playlist URL and run:
  python debug_playlist.py
"""
import sys, json, subprocess, os, yt_dlp

PLAYLIST_URL = input("Paste playlist URL: ").strip()

print("\n── Method 1: yt-dlp Python API (extract_flat=True, lazy_playlist=False) ──")
opts = {
    "quiet": True,
    "no_warnings": True,
    "extract_flat": True,
    "skip_download": True,
    "ignoreerrors": True,
    "lazy_playlist": False,   # force full fetch
    "playlistend": None,
}
with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info(PLAYLIST_URL, download=False)
entries = [e for e in (info.get("entries") or []) if e] if info else []
print(f"  → returned {len(entries)} entries")

print("\n── Method 2: subprocess --flat-playlist -J ──")
_bin = os.path.join(os.path.dirname(sys.executable), "yt-dlp")
if not os.path.isfile(_bin):
    _bin = "yt-dlp"
proc = subprocess.run(
    [_bin, "--flat-playlist", "-J", "--no-warnings", "--ignore-errors", PLAYLIST_URL],
    capture_output=True, text=True, timeout=300,
)
if proc.stdout.strip():
    info2 = json.loads(proc.stdout.strip())
    entries2 = [e for e in (info2.get("entries") or []) if e]
    print(f"  → returned {len(entries2)} entries")
else:
    print(f"  → ERROR: {proc.stderr[:300]}")
