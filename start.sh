#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  YT Downloader — Auto Setup & Run
#  Just run:  bash start.sh
# ─────────────────────────────────────────────────────────────

set -e  # stop on any error

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # no color

VENV_DIR="venv"

echo ""
echo -e "${CYAN}${BOLD}  🎬  YT Downloader — Setup${NC}"
echo -e "${CYAN}  ──────────────────────────────${NC}"
echo ""

# ── 1. Check Python ───────────────────────────────────────────
echo -e "${YELLOW}[1/4]${NC} Checking Python..."

if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ Python3 not found.${NC}"
  echo "  Install it: sudo apt install python3 python3-venv python3-full"
  exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1)
echo -e "${GREEN}✓ Found $PYTHON_VERSION${NC}"

# ── 2. Check / Install FFmpeg ─────────────────────────────────
echo ""
echo -e "${YELLOW}[2/4]${NC} Checking FFmpeg..."

if ! command -v ffmpeg &>/dev/null; then
  echo -e "${YELLOW}  FFmpeg not found. Installing...${NC}"
  if command -v apt &>/dev/null; then
    sudo apt update -qq && sudo apt install -y ffmpeg
  elif command -v brew &>/dev/null; then
    brew install ffmpeg
  else
    echo -e "${RED}✗ Could not auto-install FFmpeg.${NC}"
    echo "  Please install manually: https://ffmpeg.org/download.html"
    exit 1
  fi
fi

echo -e "${GREEN}✓ FFmpeg ready${NC}"

# ── 3. Create virtual environment ────────────────────────────
echo ""
echo -e "${YELLOW}[3/4]${NC} Setting up Python environment..."

if [ ! -d "$VENV_DIR" ]; then
  echo "  Creating virtual environment..."
  python3 -m venv "$VENV_DIR"
fi

# Activate it
source "$VENV_DIR/bin/activate"

# Upgrade pip silently
pip install --upgrade pip --quiet

# Install dependencies
echo "  Installing packages (flask, yt-dlp, socketio)..."
pip install -r requirements.txt --quiet

echo -e "${GREEN}✓ All packages installed${NC}"

# ── 4. Create downloads folder ────────────────────────────────
mkdir -p downloads

# ── 5. Start server ───────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/4]${NC} Starting server..."
echo ""
echo -e "${GREEN}${BOLD}  ✓ Ready!  Open → http://localhost:5000${NC}"
echo -e "  Press Ctrl+C to stop."
echo ""

python app.py
