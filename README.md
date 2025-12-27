# GPU Texture Capability Detector

One-page web app + simple Go backend to detect and collect GPU texture capabilities for the current browser/device.

- **WebGPU**: checks every `GPUTextureFormat` (LDR + HDR + compressed families) by validating real texture/binding creation for:
  - sampled (`TEXTURE_BINDING`)
  - filterable vs unfilterable
  - renderable (`RENDER_ATTACHMENT`)
  - storage (`STORAGE_BINDING`)
- **WebGL1/WebGL2**: reports key texture-related extensions, limits, compressed format enums, and basic float/half-float texture renderability tests.
- **Client/Device**: collects browser/OS/device info using User-Agent string + User-Agent Client Hints (`navigator.userAgentData`) when available.

## Run locally

### Recommended (Go backend + stats)

```bash
go run .
```

Requires Go 1.24+.

Open:

- `http://localhost:8080` (detector)
- `http://localhost:8080/stats` or `http://localhost:8080/stats.html` (statistics)

The detector auto-submits results to the backend (`POST /api/report`) and the stats page reads aggregates from `GET /api/stats`.

### MongoDB Atlas (recommended)

Create a `.env` file:

```bash
MONGO_URI='mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority'
MONGO_DB='hdr_detection'
```

Run the server:

```bash
go run .
```

### Local MongoDB (Docker)

Start MongoDB:

```bash
## Make sure Docker Desktop (daemon) is running first.
docker compose up -d mongo
```

Create a `.env` file:

```bash
MONGO_URI='mongodb://localhost:27017'
MONGO_DB='hdr_detection'
```

Stop MongoDB (keeps data volume):

```bash
docker compose down
```

## Deploy on Render (MongoDB Atlas)

This repo includes a `render.yaml` Blueprint for Render that provisions a **Go web service** (`hdr-detection`).

Steps:

1. Push this repo to GitHub.
2. In Render Dashboard: **New** → **Blueprint** → select your repo.
3. In the service settings, set `MONGO_URI` (MongoDB Atlas connection string) and optionally `MONGO_DB`.

Notes:

- The server binds to `:$PORT` when `PORT` is set; on Render it defaults to `:10000`.
- Health check endpoint: `GET /healthz`.
- Reports are stored in MongoDB when `MONGO_URI` is set (required when `RENDER=true`).

### Troubleshooting

- If you see a different app (or a blank page) on `http://localhost:8080`, it’s usually a cached Service Worker from another dev project on the same origin.
  - Easiest: run on a fresh origin: `go run . -addr :8090` and open `http://localhost:8090`
  - Or open `http://127.0.0.1:8080` (different origin than `localhost`)
  - Or clear site data / unregister Service Workers for that origin in your browser DevTools.
  - This server also serves a “reset” service worker at `http://localhost:8080/service-worker.js` and `http://localhost:8080/sw.js`.

### Static-only (no backend)

```bash
python3 -m http.server
```

Open `http://localhost:8000` and click **Run Detection**. (Collection/stats won’t work without the Go server.)
