/**
 * examples.js
 *
 * Ready-to-run examples for each Authenta model using AuthentaClient.
 * Functions accept Buffer | ArrayBuffer so they work in both Node.js
 * and the browser without any changes.
 *
 * Node.js usage:
 *   import { readFile } from 'fs/promises';
 *   const buf = await readFile('./video.mp4');
 *   await runDF1(buf, 'video/mp4');
 *
 * Browser usage:
 *   const file = inputElement.files[0];
 *   const buf  = await file.arrayBuffer();
 *   await runDF1(buf, file.type);
 */

import { AuthentaClient } from './authenta-client.js';

const authenta = new AuthentaClient();

// ─────────────────────────────────────────────────────────────────────────────
// DF-1 — Video Deepfake / Faceswap Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Buffer|ArrayBuffer} fileBuffer
 * @param {string} [contentType]
 * @param {string} [name]
 */
export async function runDF1(fileBuffer, contentType = 'video/mp4', name = 'df1-video') {
  console.log('Uploading video for DF-1 analysis...');

  const { mid, result } = await authenta.uploadAndWait({ name, fileBuffer, contentType, modelType: 'DF-1' });

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

/**
 * @param {Buffer|ArrayBuffer} sourceBuffer
 * @param {string} contentType
 * @param {{ faceswapCheck?: boolean, livenessCheck?: boolean, faceSimilarityCheck?: boolean, referenceBuffer?: Buffer|ArrayBuffer, referenceContentType?: string }} [options]
 */
export async function runFI1(sourceBuffer, contentType, options = {}) {
  const {
    faceSimilarityCheck    = false,
    referenceBuffer,
    referenceContentType   = 'image/jpeg',
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
  const result = await authenta.waitForResult(sourceMid);

  console.log('isDeepFake      :', result.isDeepFake);
  console.log('isLiveness      :', result.isLiveness);
  console.log('isSimilar       :', result.isSimilar);
  console.log('similarityScore :', result.similarityScore);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FE-1 — Face Embedding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Buffer|ArrayBuffer} fileBuffer
 * @param {string} [contentType]
 * @param {string} [name]
 */
export async function runFE1(fileBuffer, contentType = 'image/jpeg', name = 'fe1-image') {
  console.log('Uploading image for FE-1 embedding...');

  const { mid, result } = await authenta.uploadAndWait({ name, fileBuffer, contentType, modelType: 'FE-1' });

  console.log('mid             :', mid);
  console.log('Embedding length:', result.faceVector.length);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility — compare two FE-1 embeddings (cosine similarity → 0–100)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {number[]} vectorA
 * @param {number[]} vectorB
 * @returns {number} 0–100 similarity score
 */
export function compareFaceVectors(vectorA, vectorB) {
  if (vectorA.length !== vectorB.length) throw new Error('Vector length mismatch');
  const dot = vectorA.reduce((sum, a, i) => sum + a * vectorB[i], 0);
  return parseFloat((dot * 100).toFixed(2));
}
