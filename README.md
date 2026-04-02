# Session Replayer

A poker coaching playback tool for replaying live session hands step-by-step in a Zoom coaching environment.

## Features (Current — Phase 1-3)

- **9-handed table** with full seat rendering, positions, stacks, and card display
- **Session JSON import** — load a structured session file with up to 200 hands
- **Step-by-step script playback** — click through each action like a slideshow
- **Branch mode** — go off-script at any point, control all seats, explore "what if" scenarios
- **Back to Script** — snap back to the recorded hand at any time
- **Hand list sidebar** with navigation, starring, and player info
- **Keyboard shortcuts** — arrow keys for navigation, Escape to exit branch mode
- **Demo session** — built-in sample hands to test the interface

## Coming Soon

- **Natural language import** — upload voice-transcribed session notes (txt/docx), parsed by Claude API
- **Guided Q&A** — system asks for missing data after parsing
- **Hand review/editing UI** — confirm and fix parsed hands before coaching
- **Shorthand notation** — manual entry backup

## Quick Start

### Development
Open `session_replayer_web.html` directly in a browser. The shared engine files must be loaded — run the build script first:

```bash
python3 build_embedded.py
# Then open index.html in a browser
```

### Deployment
The build script produces a single `index.html` with all JS and card images embedded:

```bash
python3 build_embedded.py
# Deploy index.html to GitHub Pages or any static host
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design document.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Right Arrow / Space | Next step (script mode) |
| Left Arrow | Previous step (script mode) |
| Down Arrow | Next hand |
| Up Arrow | Previous hand |
| Escape | Back to Script (branch mode) |
