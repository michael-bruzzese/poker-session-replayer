# Session Replayer

A poker coaching playback tool for replaying live session hands step-by-step in a Zoom coaching environment.

**Live:** https://michael-bruzzese.github.io/poker-session-replayer/

## Features

### Playback
- **9-handed table** with full seat rendering, positions, stacks, and card display
- **Step-by-step script playback** — click through each action like a slideshow
- **Branch mode** — go off-script at any point, control all seats, explore "what if" scenarios
- **Back to Script** — snap back to the recorded hand at any time
- **Hand list sidebar** with navigation, starring, and player info
- **Player names and descriptions** visible on table and in sidebar
- **Keyboard shortcuts** — arrow keys, spacebar, Escape

### Input Pipeline
- **Session JSON import** — load structured session files with up to 200 hands
- **AI-powered parsing** — `parse_session.py` uses Claude API to convert natural language session notes into structured JSON
- **Voice note workflow** — record notes at the table, transcribe, parse, review, coach
- **Guided Q&A** — system detects missing data and asks specific questions to resolve
- **Review UI** — hand-by-hand inspection with editable fields, confirm/edit before coaching
- **Export JSON** — share cleaned session files with coaches
- **.txt and .docx support** — upload or paste session notes

### Quality of Life
- **Auto-save** — session persists in localStorage for crash recovery
- **Resume last session** — pick up where you left off
- **Demo session** — built-in sample hands to explore the interface

## Quick Start

### Try It Now
Visit https://michael-bruzzese.github.io/poker-session-replayer/ and click **Load Demo Session**.

### Parse Session Notes with AI

```bash
pip install anthropic
export ANTHROPIC_API_KEY=your-key-here

# Parse voice-transcribed notes
python3 parse_session.py my_session_notes.txt --blinds 2/5 --hero-seat 3 --name "Tuesday Night" -o session.json

# Load session.json in the web app
```

### Build from Source

```bash
python3 build_embedded.py
open index.html
```

## Workflow

1. **At the table** — Voice-record quick notes between hands on your phone
2. **After the session** — Get the transcription (text file)
3. **Parse** — Run `parse_session.py` to convert to structured JSON
4. **Review** — Open in Session Replayer, fix any parsing issues, confirm hands
5. **Coach** — Share screen on Zoom, click through hands with students

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
