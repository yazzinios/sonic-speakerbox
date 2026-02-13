

# 🎧 DJ Mixing & Broadcasting App

## Overview
A browser-based DJ mixing console with 2 decks, a crossfader, mic announcements with jingle intro, and WebRTC peer-to-peer streaming to LAN listeners. Dark pro-DJ visual style.

---

## Page 1: DJ Console (Host View)

### Deck A & Deck B
- Each deck has: **Load MP3** button (from browser file picker), track name display, **Play/Pause/Stop** controls, waveform visualization, and elapsed/remaining time
- Individual **volume sliders** per deck

### Crossfader
- Horizontal slider between Deck A and Deck B to blend audio between the two decks

### Mic Announcement Section
- **"On Air" button** — triggers a short jingle/beep sound (tan-tan-tan), then automatically ducks the music volume and activates the microphone
- **"Off Air" button** — fades mic out and brings music volume back up
- Visual "LIVE" indicator when mic is active

### Listener Panel
- Shows number of connected listeners
- Shareable link/info for listeners on the same network

---

## Page 2: Listener View

- Simple page with a **"Connect & Listen"** button
- Shows current status (connected/disconnected)
- Volume control for the listener
- Displays "Now Broadcasting" indicator when host is live

---

## Technical Approach
- **Web Audio API** for all audio mixing, crossfading, and mic ducking
- **WebRTC** for peer-to-peer audio streaming to listeners on the LAN
- Built-in jingle sound effect that plays before mic activation
- All processing happens in the browser — fully self-hosted, no external services needed
- Dark theme with neon accent colors for a professional DJ aesthetic

