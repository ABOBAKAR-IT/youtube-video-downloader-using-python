# 🎬 YT Downloader

Download YouTube videos & playlists in high quality with live progress tracking.

---

## Quick Start

### Linux / macOS
```bash
bash start.sh
```

### Windows
Double-click **`start.bat`**

That's it. Open **http://localhost:5000** in your browser.

> The script installs everything automatically (like `npm install` but for Python).

---

## If You're From Node.js

| Node.js concept   | Python equivalent                    |
|-------------------|--------------------------------------|
| `npm install`     | `pip install -r requirements.txt`    |
| `node index.js`   | `python app.py`                      |
| `node_modules/`   | `venv/`  ← auto-created by start.sh  |
| `package.json`    | `requirements.txt`                   |
| `npx`             | `pipx`                               |

The `start.sh` / `start.bat` scripts handle all of this for you.

---

## Project Structure

```
yt-downloader/
│
├── start.sh            ← Run this on Linux/macOS
├── start.bat           ← Run this on Windows
│
├── app.py              ← Backend (like server.js / index.js)
├── requirements.txt    ← Like package.json dependencies
│
├── templates/
│   └── index.html      ← Main UI page
│
├── static/
│   ├── css/style.css
│   └── js/app.js       ← Frontend JS (vanilla)
│
└── downloads/          ← Downloaded videos saved here (auto-created)
```

---

## Requirements

- **Python 3.9+** — https://python.org
- **FFmpeg** — auto-installed by start.sh on Linux/macOS
  - Windows: https://ffmpeg.org/download.html → add to PATH

---

## Features

- Single video or full playlist download
- Quality: 4K / 1440p / 1080p / 720p / 480p / 360p
- MP4 (video) or MP3 (audio only)
- Embed subtitles & thumbnails
- Live progress bar with speed + ETA per download
- Files browser to re-download saved videos
- Dark mode

---

## Updating yt-dlp

YouTube changes frequently. If downloads break:

```bash
# Linux/macOS
source venv/bin/activate && pip install -U yt-dlp

# Windows
venv\Scripts\activate && pip install -U yt-dlp
```
