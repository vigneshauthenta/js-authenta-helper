/**
 * examples.ts
 *
 * Ready-to-run examples for each Authenta model using AuthentaClient.
 * Functions accept Buffer | ArrayBuffer directly so they work in both
 * Node.js (pass the result of fs/promises readFile) and the browser
 * (pass the result of File.arrayBuffer()).
 *
 * Node usage:
 *   import { readFile } from 'fs/promises';
 *   const buf = await readFile('./video.mp4');
 *   await runDF1(buf, 'video/mp4');
 *
 * Browser usage:
 *   const file = inputElement.files[0];
 *   const buf = await file.arrayBuffer();
 *   await runDF1(buf, file.type);
 */

import { AuthentaClient, DF1Result, FI1Result, FE1Result } from './authenta-client';

const authenta = new AuthentaClient();

// ─────────────────────────────────────────────────────────────────────────────
// DF-1 — Video Deepfake / Faceswap Detection
// ─────────────────────────────────────────────────────────────────────────────

export async function runDF1(
  fileBuffer: Buffer | ArrayBuffer,
  contentType = 'video/mp4',
  name = 'df1-video',
): Promise<DF1Result> {
  console.log('Uploading video for DF-1 analysis...');

  const { mid, result } = await authenta.uploadAndWait<DF1Result>({
    name,
    fileBuffer,
    contentType,
    modelType: 'DF-1',
  });

  console.log('mid:', mid);

  for (const identity of result.identityPredictions) {
    const box = result.boundingBoxes[identity.identityId];
    console.log(`Identity ${identity.identityId}:`);
    console.log('  isDeepFake :', identity.isDeepFake);
    console.log('  class      :', box?.class);
    console.log('  confidence :', box?.confidence);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FI-1 — Face Intelligence (deepfake + liveness + similarity)
// ─────────────────────────────────────────────────────────────────────────────

export interface FI1Options {
  faceswapCheck?: boolean;       // requires video source
  livenessCheck?: boolean;       // works on image or video
  faceSimilarityCheck?: boolean; // requires referenceBuffer
  referenceBuffer?: Buffer | ArrayBuffer;
  referenceContentType?: string;
}

export async function runFI1(
  sourceBuffer: Buffer | ArrayBuffer,
  contentType: string,
  options: FI1Options = {},
): Promise<FI1Result> {
  const {
    faceSimilarityCheck = false,
    referenceBuffer,
    referenceContentType = 'image/jpeg',
  } = options;

  const sourceMid = await authenta.upload({
    name: 'fi1-source',
    fileBuffer: sourceBuffer,
    contentType,
    modelType: 'FI-1',
    ...(faceSimilarityCheck && referenceBuffer
      ? { referenceBuffer, referenceContentType }
      : {}),
  });

  console.log('Waiting for FI-1 result...');
  const result = await authenta.waitForResult<FI1Result>(sourceMid);

  console.log('isDeepFake      :', result.isDeepFake);
  console.log('isLiveness      :', result.isLiveness);
  console.log('isSimilar       :', result.isSimilar);
  console.log('similarityScore :', result.similarityScore);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FE-1 — Face Embedding
// ─────────────────────────────────────────────────────────────────────────────

export async function runFE1(
  fileBuffer: Buffer | ArrayBuffer,
  contentType = 'image/jpeg',
  name = 'fe1-image',
): Promise<FE1Result> {
  console.log('Uploading image for FE-1 embedding...');

  const { mid, result } = await authenta.uploadAndWait<FE1Result>({
    name,
    fileBuffer,
    contentType,
    modelType: 'FE-1',
  });

  console.log('mid             :', mid);
  console.log('Embedding length:', result.faceVector.length);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility — compare two FE-1 embeddings (cosine similarity → 0–100)
// ─────────────────────────────────────────────────────────────────────────────

export function compareFaceVectors(vectorA: number[], vectorB: number[]): number {
  if (vectorA.length !== vectorB.length) throw new Error('Vector length mismatch');
  const dot = vectorA.reduce((sum, a, i) => sum + a * (vectorB[i] ?? 0), 0);
  return parseFloat((dot * 100).toFixed(2));
}
