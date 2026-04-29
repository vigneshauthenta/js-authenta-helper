// ─── Types ───────────────────────────────────────────────────────────────────

export type ModelType   = 'DF-1' | 'FI-1' | 'FE-1';
export type MediaStatus = 'INITED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface AuthentaClientConfig {
  baseUrl?:      string;
  clientId?:     string;
  clientSecret?: string;
}

/** FI-1 analysis flags — controls which checks the model runs. */
export interface FI1Metadata {
  isSingleFace:        boolean; // always true for FI-1
  faceswapCheck:       boolean; // requires video source
  livenessCheck:       boolean; // image or video source
  faceSimilarityCheck: boolean; // requires referenceImage
}

export interface RegisterMediaParams {
  name:        string;
  contentType: string;
  size:        number;
  modelType:   ModelType;
  metadata?:   FI1Metadata;   // FI-1 only
}

export interface RegisterMediaResponse {
  mid:                 string;
  name:                string;
  type:                string;
  status:              MediaStatus;
  modelType:           ModelType;
  createdAt:           string;
  uploadUrl:           string;
  referenceUploadUrl?: string; // FI-1 only
}

export interface UploadParams {
  name:                  string;
  fileBuffer:            Buffer | ArrayBuffer;
  contentType:           string;
  modelType:             ModelType;
  referenceBuffer?:      Buffer | ArrayBuffer; // FI-1 + faceSimilarityCheck only
  referenceContentType?: string;               // defaults to 'image/jpeg'
  metadata?:             FI1Metadata;          // FI-1 only
}

export interface PollOptions {
  intervalMs?: number; // default 3000
  timeoutMs?:  number; // default 300000 (5 min)
}

export interface UploadAndWaitResult<T extends ModelResult = ModelResult> {
  mid:    string;
  result: T;
}

// ─── Result shapes ────────────────────────────────────────────────────────────

/** DF-1 — Video deepfake detection */
export interface DF1Result {
  resultType:          'video';
  identityPredictions: IdentityPrediction[];
  boundingBoxes:       Record<string, DF1BoundingBoxEntry>;
}

export interface IdentityPrediction {
  identityId: number;
  isDeepFake: boolean;
}

export interface DF1BoundingBoxEntry {
  boundingBox: Record<string, BoundingBoxCoords>; // { frame_0: [x1,y1,x2,y2], frame_5: ... }
  class:       'real' | 'fake';
  confidence:  number; // 0–1
}

/** FI-1 — Face intelligence (deepfake + liveness + similarity) */
export interface FI1Result {
  resultType:      'face';
  isDeepFake:      boolean | null; // null if faceswapCheck was false
  isLiveness:      boolean | null; // null if livenessCheck was false
  isSimilar:       boolean | null; // null if faceSimilarityCheck was false
  similarityScore: number  | null; // 0–100, null if faceSimilarityCheck was false
  boundingBoxes:   Record<string, FI1BoundingBoxEntry>;
}

export interface FI1BoundingBoxEntry {
  boundingBox: Record<string, BoundingBoxCoords>;
  class: {
    isDeepFake: boolean | null;
    isLiveness: boolean | null;
  };
}

/** FE-1 — Face embedding */
export interface FE1Result {
  resultType: 'face-embed';
  faceVector: number[]; // 512-dimensional, L2-normalised
}

export type ModelResult       = DF1Result | FI1Result | FE1Result;
export type BoundingBoxCoords = [number, number, number, number];

/** Media item returned by getMedia() */
export interface MediaItem {
  mid:        string;
  name:       string;
  type:       string;
  modelType:  ModelType;
  status:     MediaStatus;
  createdAt:  string;
  srcURL?:    string; // presigned S3 GET URL for the source file
  resultURL?: string; // presigned S3 GET URL for result.json — present when PROCESSED
  faces?:     number; // DF-1 summary: total faces detected
  deepFakes?: number; // DF-1 summary: deepfake count
  version?:   number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * AuthentaClient — server-side only (Next.js API routes / Server Actions).
 *
 * Reads credentials from environment variables by default:
 *   AUTHENTA_BASE_URL
 *   AUTHENTA_CLIENT_ID
 *   AUTHENTA_CLIENT_SECRET
 *
 * Full upload flow:
 *   1. POST /api/media          → { mid, uploadUrl, referenceUploadUrl? }
 *   2. PUT  {uploadUrl}         → upload source file to S3
 *   2b. PUT {referenceUploadUrl} → upload reference image (FI-1 + similarity only)
 *   3. GET  /api/media/:mid     → poll until status = PROCESSED
 *   4. GET  {resultURL}         → fetch result.json from S3
 */
export class AuthentaClient {
  readonly #baseUrl:  string;
  readonly #headers:  Record<string, string>;

  constructor({ baseUrl, clientId, clientSecret }: AuthentaClientConfig = {}) {
    const url    = baseUrl      ?? process.env.AUTHENTA_BASE_URL;
    const id     = clientId     ?? process.env.AUTHENTA_CLIENT_ID;
    const secret = clientSecret ?? process.env.AUTHENTA_CLIENT_SECRET;

    if (!url)    throw new Error('[AuthentaClient] Missing baseUrl / AUTHENTA_BASE_URL');
    if (!id)     throw new Error('[AuthentaClient] Missing clientId / AUTHENTA_CLIENT_ID');
    if (!secret) throw new Error('[AuthentaClient] Missing clientSecret / AUTHENTA_CLIENT_SECRET');

    this.#baseUrl = url;
    this.#headers = {
      'x-client-id':     id,
      'x-client-secret': secret,
      'Content-Type':    'application/json',
    };
  }

  // ─── Core request ──────────────────────────────────────────────────────────

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: this.#headers,
      body:    body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`[AuthentaClient] ${method} ${path} → HTTP ${res.status} ${detail}`.trim());
    }
    return res.status === 204 ? (null as T) : (res.json() as Promise<T>);
  }

  // ─── Media registration ────────────────────────────────────────────────────

  registerMedia(params: RegisterMediaParams): Promise<RegisterMediaResponse> {
    return this.#request<RegisterMediaResponse>('POST', '/api/media', params);
  }

  // ─── S3 upload ─────────────────────────────────────────────────────────────

  /** Presigned URL is self-authenticating — no Authenta headers needed. */
  async uploadToS3(presignedUrl: string, fileBuffer: Buffer | ArrayBuffer, contentType: string): Promise<void> {
    const res = await fetch(presignedUrl, {
      method:  'PUT',
      headers: { 'Content-Type': contentType },
      body:    fileBuffer as BodyInit,
    });
    if (!res.ok) throw new Error(`[AuthentaClient] S3 upload failed → HTTP ${res.status}`);
  }

  // ─── Media management ──────────────────────────────────────────────────────

  listMedia():          Promise<MediaItem[]>  { return this.#request('GET',    '/api/media'); }
  getMedia(mid: string): Promise<MediaItem>   { return this.#request('GET',    `/api/media/${mid}`); }
  deleteMedia(mid: string): Promise<null>     { return this.#request('DELETE', `/api/media/${mid}`); }

  // ─── High-level helpers ────────────────────────────────────────────────────

  /**
   * Register the file(s) with Authenta and upload them to S3.
   * Returns the mid — pass to waitForResult() to get the analysis output.
   */
  async upload({
    name, fileBuffer, contentType, modelType,
    referenceBuffer, referenceContentType = 'image/jpeg', metadata,
  }: UploadParams): Promise<string> {
    const size = fileBuffer instanceof Buffer ? fileBuffer.length : fileBuffer.byteLength;
    const reg  = await this.registerMedia({ name, contentType, size, modelType, metadata });

    await this.uploadToS3(reg.uploadUrl, fileBuffer, contentType);

    if (referenceBuffer && reg.referenceUploadUrl) {
      await this.uploadToS3(reg.referenceUploadUrl, referenceBuffer, referenceContentType);
    }

    return reg.mid;
  }

  /**
   * Poll getMedia() until status = PROCESSED, then fetch result.json from S3.
   */
  async waitForResult<T extends ModelResult = ModelResult>(
    mid: string,
    { intervalMs = 3_000, timeoutMs = 300_000 }: PollOptions = {},
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const media = await this.getMedia(mid);

      if (media.status === 'PROCESSED') {
        if (!media.resultURL) throw new Error(`[AuthentaClient] No resultURL for mid: ${mid}`);
        const res = await fetch(media.resultURL);
        if (!res.ok) throw new Error(`[AuthentaClient] Failed to fetch result.json → HTTP ${res.status}`);
        return res.json() as Promise<T>;
      }

      if (media.status === 'FAILED') {
        throw new Error(`[AuthentaClient] Processing failed for mid: ${mid}`);
      }

      await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`[AuthentaClient] Timed out waiting for mid: ${mid}`);
  }

  /**
   * One-call shortcut: upload → wait → return result.
   */
  async uploadAndWait<T extends ModelResult = ModelResult>(
    params:      UploadParams,
    pollOptions?: PollOptions,
  ): Promise<UploadAndWaitResult<T>> {
    const mid    = await this.upload(params);
    const result = await this.waitForResult<T>(mid, pollOptions);
    return { mid, result };
  }
}
