# Authenta — Next.js Integration Guide

Drop-in integration for the Authenta deepfake analysis API inside a Next.js App Router project.

---

## What's in this folder

```
nextjs/
  lib/
    authenta-client.ts      ← Copy this into your project (src/lib/)
  app/
    api/
      analyse/
        route.ts            ← Copy this into your project (app/api/analyse/)
  components/
    AuthentaAnalyser.tsx    ← Optional example React component
  README.md
```

---

## Step 1 — Copy the files

```
src/
  lib/
    authenta-client.ts      ← from nextjs/lib/
  app/
    api/
      analyse/
        route.ts            ← from nextjs/app/api/analyse/
  components/
    AuthentaAnalyser.tsx    ← from nextjs/components/  (optional)
```

---

## Step 2 — Add environment variables

Create or update `.env.local` in your Next.js project root:

```env
AUTHENTA_BASE_URL=https://platform.authenta.ai
AUTHENTA_CLIENT_ID=your_client_id_here
AUTHENTA_CLIENT_SECRET=your_client_secret_here
```

These are only ever read server-side (inside `route.ts` / Server Actions).
They are **never** exposed to the browser.

---

## Step 3 — Use the API route

The route accepts `POST /api/analyse` with `multipart/form-data`:

| Field            | Type   | Required | Description                                    |
|------------------|--------|----------|------------------------------------------------|
| `file`           | File   | Yes      | Video (DF-1) or image (FI-1, FE-1)            |
| `modelType`      | string | Yes      | `"DF-1"`, `"FI-1"`, or `"FE-1"`              |
| `referenceImage` | File   | No       | FI-1 only — reference face for similarity check |

Response: `{ mid: string, result: ModelResult }`

### Call it from a client component

```ts
const body = new FormData();
body.append('file',      videoFile);
body.append('modelType', 'DF-1');

const res  = await fetch('/api/analyse', { method: 'POST', body });
const { mid, result } = await res.json();
```

### Or from a Server Action

```ts
'use server';

import { AuthentaClient } from '@/lib/authenta-client';

export async function analyseVideo(formData: FormData) {
  const file   = formData.get('file') as File;
  const buffer = await file.arrayBuffer();

  const authenta = new AuthentaClient();   // reads env vars automatically

  const { mid, result } = await authenta.uploadAndWait({
    name:        file.name,
    fileBuffer:  buffer,
    contentType: file.type,
    modelType:   'DF-1',
  });

  return { mid, result };
}
```

---

## Step 4 — Handle results

### DF-1 — Video Deepfake

```ts
import type { DF1Result } from '@/lib/authenta-client';

const result = data.result as DF1Result;

for (const identity of result.identityPredictions) {
  console.log(`Identity ${identity.identityId}: ${identity.isDeepFake ? 'FAKE' : 'REAL'}`);
}
```

### FI-1 — Face Intelligence

```ts
import type { FI1Result } from '@/lib/authenta-client';

const result = data.result as FI1Result;

console.log(result.isDeepFake);      // boolean | null  (null = check not requested)
console.log(result.isLiveness);      // boolean | null
console.log(result.isSimilar);       // boolean | null
console.log(result.similarityScore); // 0–100   | null
```

### FE-1 — Face Embedding

```ts
import type { FE1Result } from '@/lib/authenta-client';

const result = data.result as FE1Result;

console.log(result.faceVector.length); // 512
// Use dot product of two L2-normalised vectors to compare faces (0–100 scale)
```

---

## Step 5 — (Optional) Drop in the example component

`AuthentaAnalyser.tsx` is a ready-to-use client component that wires up all three models with a file picker, progress states, and a results display.

```tsx
import AuthentaAnalyser from '@/components/AuthentaAnalyser';

export default function Page() {
  return <AuthentaAnalyser />;
}
```

Style it however you like — it has minimal inline styles only.

---

## How the flow works end-to-end

```
Browser                    Next.js server               Authenta API        S3
  │                              │                           │               │
  │  POST /api/analyse           │                           │               │
  │  (FormData: file + model)    │                           │               │
  │─────────────────────────────>│                           │               │
  │                              │  POST /api/media          │               │
  │                              │  { name, size, type, model}               │
  │                              │──────────────────────────>│               │
  │                              │  ← { mid, uploadUrl, referenceUploadUrl? }│
  │                              │                           │               │
  │                              │  PUT {uploadUrl}          │               │
  │                              │  (raw file bytes)         │               │
  │                              │──────────────────────────────────────────>│
  │                              │                           │               │
  │                              │  GET /api/media/:mid  (poll every 3s)     │
  │                              │──────────────────────────>│               │
  │                              │  ← { status: "PROCESSED", resultURL }     │
  │                              │                           │               │
  │                              │  GET {resultURL}          │               │
  │                              │──────────────────────────────────────────>│
  │                              │  ← result.json            │               │
  │                              │                           │               │
  │  ← { mid, result }           │                           │               │
  │<─────────────────────────────│                           │               │
```

Credentials (`x-client-id`, `x-client-secret`) are only ever sent from the Next.js server to Authenta — never to the browser.

---

## Direct client usage (outside the route)

You can use `AuthentaClient` anywhere server-side — Server Actions, `generateMetadata`, middleware, cron jobs, etc.:

```ts
import { AuthentaClient } from '@/lib/authenta-client';

const authenta = new AuthentaClient();
// or with explicit config:
// new AuthentaClient({ baseUrl, clientId, clientSecret })

// Register + upload only (fire-and-forget style)
const mid = await authenta.upload({ name, fileBuffer, contentType, modelType });

// Poll later
const result = await authenta.waitForResult(mid, { intervalMs: 5_000, timeoutMs: 120_000 });

// Or one call does everything
const { mid, result } = await authenta.uploadAndWait({ name, fileBuffer, contentType, modelType });

// Media management
const list  = await authenta.listMedia();
const item  = await authenta.getMedia(mid);
await authenta.deleteMedia(mid);
```

---

## Error messages

```
[AuthentaClient] Missing baseUrl / AUTHENTA_BASE_URL      — env var not set
[AuthentaClient] POST /api/media → HTTP 401               — wrong credentials
[AuthentaClient] S3 upload failed → HTTP 403              — presigned URL expired
[AuthentaClient] Processing failed for mid: <id>          — model returned FAILED
[AuthentaClient] Timed out waiting for mid: <id>          — exceeded timeoutMs
[AuthentaClient] No resultURL for mid: <id>               — PROCESSED but URL missing
```
