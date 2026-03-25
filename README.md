# 🎧 Sonic Speakerbox

**4-Channel DJ Streaming Console** — broadcast live audio from your browser or server, manage playlists, receive song requests, and stream via Icecast to any VLC-compatible player.

---

## 📸 Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui |
| Audio Engine | Web Audio API (browser mode) |
| Streaming | Liquidsoap + Icecast |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Deployment | Docker + nginx |

---

## 🚀 Quick Start

### 1. Clone & install

```bash
git clone <YOUR_GIT_URL>
cd sonic-speakerbox
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your real Supabase keys and passwords
```

### 3. Run in development

```bash
npm run dev
# App available at http://localhost:5173
```

---

## 🐳 Docker Deployment (Production)

### Prerequisites
- Docker + Docker Compose installed
- `.env` file configured (see `.env.example`)

### Launch

```bash
docker compose up -d
```

| Service | URL |
|---|---|
| DJ Console | `http://YOUR_IP:8083` |
| Icecast Streams | `http://YOUR_IP:8001/deck-a` through `/deck-d` |
| API | `http://YOUR_IP/api` |

### Listen in VLC (Windows)

```
Media → Open Network Stream → http://YOUR_IP:8001/deck-a
```

---

## 🎛️ Modes

### Browser Mode (`SERVER_MODE = false`)
Audio plays locally in the browser using the Web Audio API. Broadcasting sends the audio stream to the server.

### Server Mode (`SERVER_MODE = true`)  ← Default
The browser acts as a **remote control only**. All audio is played and streamed server-side via Liquidsoap → Icecast. Best for production.

To switch modes, edit `src/lib/streamingServer.ts`:
```ts
export const SERVER_MODE = true; // or false
```

---

## 📡 Architecture

```
┌─────────────────────────────────────────────────┐
│                  Browser (DJ)                   │
│  React App → REST API → radio-server:3001       │
└──────────────────┬──────────────────────────────┘
                   │ docker network
┌──────────────────▼──────────────────────────────┐
│               radio-server container            │
│  Node.js API + Liquidsoap + Icecast             │
│  /deck-a  /deck-b  /deck-c  /deck-d  :8001      │
└──────────────────┬──────────────────────────────┘
                   │ stream
┌──────────────────▼──────────────────────────────┐
│               Listeners (VLC / Browser)         │
└─────────────────────────────────────────────────┘
```

---

## 🔐 Security

- **Never commit `.env`** — it is listed in `.gitignore`
- All secrets are passed via environment variables at runtime
- Use strong passwords for `ICECAST_SOURCE_PASSWORD` and `ICECAST_ADMIN_PASSWORD`
- Admin panel is protected behind Supabase Auth

---

## 🧪 Tests

```bash
npm run test          # run all tests
npm run test -- --ui  # visual test runner
```

Tests cover: DeckState defaults, EQ/volume clamping, playlist skip logic, request validation, cooldown guard, stream URL builder.

---

## 📂 Project Structure

```
src/
├── components/
│   ├── dj/          # Deck, Controls, Library, Playlists, Stats
│   └── ui/          # shadcn/ui components
├── hooks/
│   ├── useAudioEngine.ts    # Core Web Audio API engine
│   ├── useMusicRequests.ts  # PeerJS song request system
│   ├── useHLSBroadcast.ts   # HLS broadcast
│   └── ...
├── pages/
│   ├── Index.tsx            # Main DJ console
│   ├── AnalyticsPage.tsx    # Stats & charts
│   ├── RequestPage.tsx      # Public song request form
│   ├── ListenerPage.tsx     # Listener stream page
│   └── SettingsPage.tsx     # Admin settings
├── lib/
│   └── streamingServer.ts   # Server config & mode
└── types/
    └── channels.ts          # Deck IDs & colors
streaming-server/
├── server.js                # Node.js REST API
├── radio.liq                # Liquidsoap script
├── icecast.xml.template     # Icecast config template
└── Dockerfile
```

---

## 🛠️ Available Scripts

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run preview   # Preview production build
npm run test      # Run tests
npm run lint      # ESLint
```

---

## 🔗 Public Pages (no auth required)

| Route | Description |
|---|---|
| `/listen?code=XXX` | Listener stream page |
| `/request?host=XXX` | Public song request form |

---

## 📄 License

MIT
