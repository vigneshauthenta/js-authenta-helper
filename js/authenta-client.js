/**
 * AuthentaClient — JavaScript version
 *
 * Upload flow:
 *   1. registerMedia()  → POST /api/media  → { mid, uploadUrl, referenceUploadUrl? }
 *   2. uploadToS3()     → PUT uploadUrl    → upload source file
 *   2b. uploadToS3()    → PUT referenceUploadUrl → upload reference image (FI-1 only)
 *   3. waitForResult()  → GET /api/media/:mid until status = PROCESSED
 *   4.                  → GET resultURL (S3) → parse result.json
 *
 * MediaStatus: 'INITED' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
 * ModelType:   'DF-1'   | 'FI-1'       | 'FE-1'
 */

export class AuthentaClient {
  #baseUrl;
  #headers;

  constructor({ baseUrl, clientId, clientSecret } = {}) {
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

  async #request(method, path, body) {
    const res = await fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: this.#headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`[AuthentaClient] ${method} ${path} → HTTP ${res.status} ${detail}`.trim());
    }
    return res.status === 204 ? null : res.json();
  }

  registerMedia(params) {
    return this.#request('POST', '/api/media', params);
  }

  async uploadToS3(presignedUrl, fileBuffer, contentType) {
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: fileBuffer,
    });
    if (!res.ok) throw new Error(`[AuthentaClient] S3 upload failed → HTTP ${res.status}`);
  }

  listMedia()        { return this.#request('GET',    '/api/media'); }
  getMedia(mid)      { return this.#request('GET',    `/api/media/${mid}`); }
  deleteMedia(mid)   { return this.#request('DELETE', `/api/media/${mid}`); }

  async upload({ name, fileBuffer, contentType, modelType, referenceBuffer, referenceContentType = 'image/jpeg' }) {
    const size = fileBuffer instanceof Buffer ? fileBuffer.length : fileBuffer.byteLength;
    const reg  = await this.registerMedia({ name, contentType, size, modelType });

    await this.uploadToS3(reg.uploadUrl, fileBuffer, contentType);

    if (referenceBuffer && reg.referenceUploadUrl) {
      await this.uploadToS3(reg.referenceUploadUrl, referenceBuffer, referenceContentType);
    }

    return reg.mid;
  }

  async waitForResult(mid, { intervalMs = 3_000, timeoutMs = 300_000 } = {}) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const media = await this.getMedia(mid);

      if (media.status === 'PROCESSED') {
        if (!media.resultURL) throw new Error(`[AuthentaClient] No resultURL on mid: ${mid}`);
        const res = await fetch(media.resultURL);
        if (!res.ok) throw new Error(`[AuthentaClient] Failed to fetch result.json: HTTP ${res.status}`);
        return res.json();
      }

      if (media.status === 'FAILED') throw new Error(`[AuthentaClient] Processing failed for mid: ${mid}`);

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`[AuthentaClient] Timed out waiting for mid: ${mid}`);
  }

  async uploadAndWait(params, pollOptions) {
    const mid    = await this.upload(params);
    const result = await this.waitForResult(mid, pollOptions);
    return { mid, result };
  }
}
