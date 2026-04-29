// ─── Types ───────────────────────────────────────────────────────────────────

export type ModelType = 'DF-1' | 'FI-1' | 'FE-1';

// Uppercase — matches actual API response values
export type MediaStatus = 'INITED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

export interface AuthentaClientConfig {
  baseUrl?: string;
  clientId?: string;
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
  mid: string;
  name: string;
  type: string;
  status: MediaStatus;
  modelType: ModelType;
  createdAt: string;
  uploadUrl: string;
  referenceUploadUrl?: string;  // FI-1 only — presigned URL for reference image
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
  intervalMs?: number;
  timeoutMs?: number;
}

export interface UploadAndWaitResult<T extends ModelResult = ModelResult> {
  mid: string;
  result: T;
}

// ─── Model result types ───────────────────────────────────────────────────────

/** DF-1 — Video deepfake / faceswap */
export interface DF1Result {
  resultType: 'video';
  identityPredictions: IdentityPrediction[];
  boundingBoxes: Record<string, DF1BoundingBoxEntry>;
}

export interface IdentityPrediction {
  identityId: number;
  isDeepFake: boolean;
}

export interface DF1BoundingBoxEntry {
  boundingBox: Record<string, BoundingBoxCoords>;
  class: 'real' | 'fake';
  confidence: number; // 0–1
}

/** FI-1 — Face intelligence */
export interface FI1Result {
  resultType: 'face';
  isDeepFake: boolean | null;
  isLiveness: boolean | null;
  isSimilar: boolean | null;
  similarityScore: number | null; // 0–100
  boundingBoxes: Record<string, FI1BoundingBoxEntry>;
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

export type ModelResult = DF1Result | FI1Result | FE1Result;

export type BoundingBoxCoords = [number, number, number, number];

/**
 * Media item returned by getMedia() / listMedia().
 * When status = PROCESSED, resultURL points to the result.json on S3.
 * The result JSON itself is NOT inline — fetch resultURL to get it.
 */
export interface MediaItem {
  mid: string;
  name: string;
  type: string;
  modelType: ModelType;
  status: MediaStatus;
  createdAt: string;
  srcURL?: string;       // presigned S3 GET URL for the source file
  resultURL?: string;    // presigned S3 GET URL for result.json (present when PROCESSED)
  faces?: number;        // DF-1: total faces detected (summary)
  deepFakes?: number;    // DF-1: deepfake count (summary)
  version?: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * AuthentaClient
 *
 * Typed JS client for the Authenta API.
 *
 * Upload flow:
 *   1. registerMedia()  → POST /api/media  → { mid, uploadUrl, referenceUploadUrl? }
 *   2. uploadToS3()     → PUT uploadUrl    → upload source file
 *   2b. uploadToS3()    → PUT referenceUploadUrl → upload reference image (FI-1 only)
 *   3. waitForResult()  → GET /api/media/:mid until status = PROCESSED
 *   4.                  → GET resultURL (S3) → parse result.json
 */
export class AuthentaClient {
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;

  constructor({ baseUrl, clientId, clientSecret }: AuthentaClientConfig = {}) {
    const resolvedBase   = baseUrl      ?? process.env.AUTHENTA_BASE_URL;
    const resolvedId     = clientId     ?? process.env.AUTHENTA_CLIENT_ID;
    const resolvedSecret = clientSecret ?? process.env.AUTHENTA_CLIENT_SECRET;

    if (!resolvedBase)   throw new Error('[AuthentaClient] Missing baseUrl / AUTHENTA_BASE_URL');
    if (!resolvedId)     throw new Error('[AuthentaClient] Missing clientId / AUTHENTA_CLIENT_ID');
    if (!resolvedSecret) throw new Error('[AuthentaClient] Missing clientSecret / AUTHENTA_CLIENT_SECRET');

    this.#baseUrl = resolvedBase;
    this.#headers = {
      'x-client-id':     resolvedId,
      'x-client-secret': resolvedSecret,
      'Content-Type':    'application/json',
    };
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: this.#headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`[AuthentaClient] ${method} ${path} → HTTP ${res.status} ${detail}`.trim());
    }
    return res.status === 204 ? (null as T) : (res.json() as Promise<T>);
  }

  // ─── Step 1: Register ──────────────────────────────────────────────────────

  registerMedia(params: RegisterMediaParams): Promise<RegisterMediaResponse> {
    return this.#request<RegisterMediaResponse>('POST', '/api/media', params);
  }

  // ─── Step 2: Upload to S3 ─────────────────────────────────────────────────

  async uploadToS3(presignedUrl: string, fileBuffer: Buffer | ArrayBuffer, contentType: string): Promise<void> {
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: fileBuffer,
    });
    if (!res.ok) throw new Error(`[AuthentaClient] S3 upload failed → HTTP ${res.status}`);
  }

  // ─── Media management ─────────────────────────────────────────────────────

  listMedia(): Promise<MediaItem[]> {
    return this.#request<MediaItem[]>('GET', '/api/media');
  }

  getMedia(mid: string): Promise<MediaItem> {
    return this.#request<MediaItem>('GET', `/api/media/${mid}`);
  }

  deleteMedia(mid: string): Promise<null> {
    return this.#request<null>('DELETE', `/api/media/${mid}`);
  }

  // ─── High-level helpers ───────────────────────────────────────────────────

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
   * Poll until status = PROCESSED, then fetch result.json from resultURL.
   * The result is stored on S3 — this makes two fetches: one to the API (polling)
   * and one to S3 (fetching the actual result JSON).
   */
  async waitForResult<T extends ModelResult = ModelResult>(
    mid: string,
    { intervalMs = 3_000, timeoutMs = 300_000 }: PollOptions = {},
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const media = await this.getMedia(mid);

      if (media.status === 'PROCESSED') {
        if (!media.resultURL) throw new Error(`[AuthentaClient] No resultURL on mid: ${mid}`);
        const res = await fetch(media.resultURL);
        if (!res.ok) throw new Error(`[AuthentaClient] Failed to fetch result.json: HTTP ${res.status}`);
        return res.json() as Promise<T>;
      }

      if (media.status === 'FAILED') throw new Error(`[AuthentaClient] Processing failed for mid: ${mid}`);

      await new Promise<void>(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`[AuthentaClient] Timed out waiting for mid: ${mid}`);
  }

  async uploadAndWait<T extends ModelResult = ModelResult>(
    params: UploadParams,
    pollOptions?: PollOptions,
  ): Promise<UploadAndWaitResult<T>> {
    const mid    = await this.upload(params);
    const result = await this.waitForResult<T>(mid, pollOptions);
    return { mid, result };
  }
}
