#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  YT Downloader — Auto Setup & Run
#  Just run:  bash start.sh
# ─────────────────────────────────────────────────────────────

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

VENV_DIR="venv"
PORT="${PORT:-7000}"

echo ""
echo -e "${CYAN}${BOLD}  🎬  YT Downloader — Setup${NC}"
echo -e "${CYAN}  ──────────────────────────────${NC}"
echo ""

# ── 1. Check Python ───────────────────────────────────────────
echo -e "${YELLOW}[1/4]${NC} Checking Python..."
if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ Python3 not found.${NC}"
  echo "  Run: sudo apt install python3 python3-venv python3-full"
  exit 1
fi
echo -e "${GREEN}✓ $(python3 --version)${NC}"

# ── 2. Check FFmpeg ───────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/4]${NC} Checking FFmpeg..."
if ! command -v ffmpeg &>/dev/null; then
  echo -e "${YELLOW}  Installing FFmpeg...${NC}"
  if command -v apt &>/dev/null; then
    sudo apt update -qq && sudo apt install -y ffmpeg
  elif command -v brew &>/dev/null; then
    brew install ffmpeg
  else
    echo -e "${RED}✗ Please install FFmpeg manually: https://ffmpeg.org/download.html${NC}"
    exit 1
  fi
fi
echo -e "${GREEN}✓ FFmpeg ready${NC}"

# ── 3. Virtual environment + packages ─────────────────────────
echo ""
echo -e "${YELLOW}[3/4]${NC} Setting up Python environment..."
if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
echo -e "${GREEN}✓ Packages ready (flask, yt-dlp)${NC}"

# ── 4. Create downloads folder ────────────────────────────────
mkdir -p downloads

# ── 5. Launch ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  ✓ Open → http://localhost:${PORT}${NC}"
echo -e "  Press Ctrl+C to stop."
echo ""

PORT=$PORT python app.py
