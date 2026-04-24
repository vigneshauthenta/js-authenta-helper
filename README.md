# Authenta API — Integration Helper

Client code and a browser test console for the Authenta deepfake analysis API.

> **Integrating with a Next.js application?**
> Follow the dedicated guide: [nextjs/README.md](nextjs/README.md)

---

## Folder Structure

```
helper/
  ts/
    authenta-client.ts    ← Client class + all TypeScript types
    examples.ts           ← Typed usage examples for each model
    tsconfig.json         ← TS config (types: node)
  js/
    authenta-client.js    ← Same client, plain JavaScript
    examples.js           ← JS usage examples
    jsconfig.json         ← VS Code IntelliSense config
  proxy.js                ← Local dev proxy (serves test.html + forwards API calls)
  test.html               ← Browser test console
  test.css                ← Styles for test.html
  .env.example            ← Credential template — copy to .env
  package.json
  README.md
```

---

## How the API Works

Every request to Authenta requires two custom headers:

```
x-client-id:     YOUR_CLIENT_ID
x-client-secret: YOUR_CLIENT_SECRET
```

### Upload flow (all three models)

```
1.  POST /api/media
      body: { name, contentType, size, modelType }
    ← { mid, uploadUrl, referenceUploadUrl? }

2.  PUT {uploadUrl}
      body: raw file bytes
      (no auth headers — presigned URL is self-authenticating)

2b. PUT {referenceUploadUrl}          ← FI-1 only, when faceSimilarityCheck
      body: raw reference image bytes

3.  GET /api/media/:mid               ← poll every 3s
    ← { status: 'INITED' | 'PROCESSING' | 'PROCESSED' | 'FAILED', ... }

4.  GET {resultURL}                   ← when status = PROCESSED
    ← result.json (the actual model output)
```

The result JSON is **not** returned inline in the media item. It lives on S3
and is accessed via the `resultURL` presigned link in the poll response.

---

## What to Install

### TypeScript (`ts/`)

```bash
# from the helper/ folder
npm install
```

This pulls in `@types/node` — the only dependency. It gives TypeScript the type
definitions for `Buffer` and `process.env`. No runtime code is added.

If you copy `ts/authenta-client.ts` into an existing project:

| Project | Action |
|---------|--------|
| Next.js / Node.js | Nothing — `@types/node` is already there |
| Vite + React | Add `"types": ["node"]` to `tsconfig.json` compilerOptions |

### JavaScript (`js/`)

Nothing to install. Uses native `fetch` (Node 18+ / all modern browsers).

### Test console

Nothing to install. Run `node proxy.js` and open the browser.

---

## Running the Test Console

**1. Copy `.env.example` to `.env` and fill in your credentials**

```env
AUTHENTA_BASE_URL=https://platform.authenta.ai
AUTHENTA_CLIENT_ID=your_client_id_here
AUTHENTA_CLIENT_SECRET=your_client_secret_here
```

**2. Start the proxy**

```bash
# from the helper/ folder
node proxy.js
# or
npm start
```

**3. Open the console**

```
http://localhost:3001
```

Credentials are never sent to the browser — the proxy reads them from `.env`
and injects them as headers when forwarding requests to Authenta.

---

## Using the TypeScript Client

Copy `ts/authenta-client.ts` into your project.

```ts
import { AuthentaClient, DF1Result, FI1Result, FE1Result } from './authenta-client';

const authenta = new AuthentaClient();
// reads AUTHENTA_BASE_URL, AUTHENTA_CLIENT_ID, AUTHENTA_CLIENT_SECRET from process.env
// or pass them directly: new AuthentaClient({ baseUrl, clientId, clientSecret })
```

### DF-1 — Video Deepfake

```ts
const { mid, result } = await authenta.uploadAndWait<DF1Result>({
  name:        'clip.mp4',
  fileBuffer,               // Buffer (Node) or ArrayBuffer (browser)
  contentType: 'video/mp4',
  modelType:   'DF-1',
});

for (const identity of result.identityPredictions) {
  console.log(`Identity ${identity.identityId}: ${identity.isDeepFake ? 'FAKE' : 'REAL'}`);
}
```

### FI-1 — Face Intelligence

```ts
const { mid, result } = await authenta.uploadAndWait<FI1Result>({
  name:        'selfie.jpg',
  fileBuffer:  sourceBuffer,
  contentType: 'image/jpeg',
  modelType:   'FI-1',
  // optional — only when faceSimilarityCheck is enabled
  referenceBuffer,
  referenceContentType: 'image/jpeg',
});

console.log(result.isDeepFake);      // boolean | null
console.log(result.isLiveness);      // boolean | null
console.log(result.isSimilar);       // boolean | null
console.log(result.similarityScore); // 0–100   | null
```

Fields are `null` when the corresponding check was not requested.

### FE-1 — Face Embedding

```ts
const { mid, result } = await authenta.uploadAndWait<FE1Result>({
  name:        'face.jpg',
  fileBuffer,
  contentType: 'image/jpeg',
  modelType:   'FE-1',
});

console.log(result.faceVector.length); // 512
```

### Compare two FE-1 embeddings

```ts
import { compareFaceVectors } from './examples';

const score = compareFaceVectors(resultA.faceVector, resultB.faceVector);
// score is 0–100, same scale as FI-1 similarityScore
```

### Control polling

```ts
const { mid, result } = await authenta.uploadAndWait(params, {
  intervalMs: 5_000,   // poll every 5s (default 3s)
  timeoutMs:  120_000, // give up after 2 min (default 5 min)
});
```

### Step by step (without uploadAndWait)

```ts
// 1. Register + upload
const mid = await authenta.upload({ name, fileBuffer, contentType, modelType });

// 2. Poll separately (e.g. store mid, resume later)
const result = await authenta.waitForResult(mid);

// 3. Or just check status once
const media = await authenta.getMedia(mid);
// media.status: 'INITED' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
// media.resultURL — present when PROCESSED
```

---

## Model Result Shapes

### DF-1

```json
{
  "resultType": "video",
  "identityPredictions": [
    { "identityId": 0, "isDeepFake": false },
    { "identityId": 1, "isDeepFake": true }
  ],
  "boundingBoxes": {
    "0": {
      "boundingBox": { "frame_0": [120, 80, 340, 360], "frame_5": [125, 82, 345, 365] },
      "class": "real",
      "confidence": 0.9523
    }
  }
}
```

- One entry per detected face identity across the video
- `confidence` is 0–1 (raw probability)
- `boundingBox` keys are `frame_0`, `frame_5`, `frame_10`, … (every 5th frame)

### FI-1

```json
{
  "resultType": "face",
  "isDeepFake": false,
  "isLiveness": true,
  "isSimilar": true,
  "similarityScore": 92.34,
  "boundingBoxes": {
    "0": {
      "boundingBox": { "frame_0": [120, 80, 340, 360] },
      "class": { "isDeepFake": false, "isLiveness": true }
    }
  }
}
```

- Always single-face — bounding box key is always `"0"`
- `null` fields = that check was not requested
- `similarityScore` is 0–100 (higher = more similar)
- Image input → `frame_0` only; video input → every 5th frame

### FE-1

```json
{
  "resultType": "face-embed",
  "faceVector": [0.0312, -0.1847, 0.0923, "...512 total"]
}
```

- 512-dimensional, L2-normalised (unit length)
- Cosine similarity = dot product = `dot(A, B) × 100` → 0–100 score

---

## API Method Reference

| Method | Description |
|--------|-------------|
| `registerMedia(params)` | POST `/api/media` — returns `mid`, `uploadUrl`, `referenceUploadUrl?` |
| `uploadToS3(url, buf, type)` | PUT file bytes to a presigned S3 URL (no auth needed) |
| `upload(params)` | `registerMedia` + `uploadToS3` combined — returns `mid` |
| `waitForResult(mid, opts?)` | Poll until `PROCESSED`, fetch `resultURL`, return result |
| `uploadAndWait(params, opts?)` | `upload` + `waitForResult` — returns `{ mid, result }` |
| `listMedia()` | GET all media items |
| `getMedia(mid)` | GET one media item — includes `resultURL` when `PROCESSED` |
| `deleteMedia(mid)` | DELETE a media item |

---

## Error Messages

```
[AuthentaClient] POST /api/media → HTTP 401       — bad credentials
[AuthentaClient] S3 upload failed → HTTP 403      — presigned URL expired
[AuthentaClient] Processing failed for mid: ...   — model returned FAILED
[AuthentaClient] Timed out waiting for mid: ...   — took longer than timeoutMs
[AuthentaClient] No resultURL on mid: ...         — PROCESSED but URL missing
```
