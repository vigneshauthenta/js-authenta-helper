'use client';

import { useState, useRef } from 'react';
import type {
  ModelType,
  ModelResult,
  DF1Result,
  FI1Result,
  FE1Result,
} from '@/lib/authenta-client';

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalyseResponse =
  | { mid: string; result: ModelResult }
  | { error: string };

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthentaAnalyser() {
  const [modelType,  setModelType]  = useState<ModelType>('DF-1');
  const [status,     setStatus]     = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle');
  const [response,   setResponse]   = useState<AnalyseResponse | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const refRef  = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setStatus('uploading');
    setResponse(null);

    const body = new FormData();
    body.append('file',      file);
    body.append('modelType', modelType);

    if (modelType === 'FI-1') {
      const ref = refRef.current?.files?.[0];
      if (ref) body.append('referenceImage', ref);
    }

    try {
      setStatus('processing');
      const res  = await fetch('/api/analyse', { method: 'POST', body });
      const data = (await res.json()) as AnalyseResponse;
      setResponse(data);
      setStatus(res.ok ? 'done' : 'error');
    } catch (err) {
      setResponse({ error: err instanceof Error ? err.message : 'Network error' });
      setStatus('error');
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h2>Authenta Analyser</h2>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>

        {/* Model selector */}
        <label>
          Model
          <select
            value={modelType}
            onChange={e => setModelType(e.target.value as ModelType)}
            style={{ marginLeft: 8 }}
          >
            <option value="DF-1">DF-1 — Video Deepfake</option>
            <option value="FI-1">FI-1 — Face Intelligence</option>
            <option value="FE-1">FE-1 — Face Embedding</option>
          </select>
        </label>

        {/* Source file */}
        <label>
          {modelType === 'DF-1' ? 'Video file' : 'Image file'}
          <input ref={fileRef} type="file"
            accept={modelType === 'DF-1' ? 'video/*' : 'image/*'}
            required style={{ marginLeft: 8 }}
          />
        </label>

        {/* Reference image — FI-1 only */}
        {modelType === 'FI-1' && (
          <label>
            Reference image (optional — for similarity check)
            <input ref={refRef} type="file" accept="image/*" style={{ marginLeft: 8 }} />
          </label>
        )}

        <button type="submit" disabled={status === 'uploading' || status === 'processing'}>
          {status === 'uploading'  ? 'Uploading…'   :
           status === 'processing' ? 'Analysing…'   :
           'Analyse'}
        </button>
      </form>

      {/* Results */}
      {status === 'done' && response && !('error' in response) && (
        <ResultView response={response} modelType={modelType} />
      )}

      {status === 'error' && response && 'error' in response && (
        <p style={{ color: 'red', marginTop: 16 }}>{response.error}</p>
      )}
    </div>
  );
}

// ─── Result display ───────────────────────────────────────────────────────────

function ResultView({ response, modelType }: {
  response: { mid: string; result: ModelResult };
  modelType: ModelType;
}) {
  const { mid, result } = response;

  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ fontSize: 12, color: '#666' }}>mid: {mid}</p>

      {modelType === 'DF-1' && <DF1View result={result as DF1Result} />}
      {modelType === 'FI-1' && <FI1View result={result as FI1Result} />}
      {modelType === 'FE-1' && <FE1View result={result as FE1Result} />}

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#666' }}>Raw JSON</summary>
        <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 12, overflow: 'auto', marginTop: 8 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function DF1View({ result }: { result: DF1Result }) {
  return (
    <div>
      <h3>Deepfake Detection</h3>
      {result.identityPredictions.map(p => (
        <p key={p.identityId}>
          Identity {p.identityId}: <strong style={{ color: p.isDeepFake ? 'red' : 'green' }}>
            {p.isDeepFake ? 'FAKE' : 'REAL'}
          </strong>
        </p>
      ))}
    </div>
  );
}

function FI1View({ result }: { result: FI1Result }) {
  const rows: [string, boolean | null | number][] = [
    ['Deepfake',         result.isDeepFake],
    ['Liveness',         result.isLiveness],
    ['Similar',          result.isSimilar],
    ['Similarity score', result.similarityScore],
  ];

  return (
    <div>
      <h3>Face Intelligence</h3>
      {rows.map(([label, value]) => (
        <p key={label}>
          {label}: {value === null ? <span style={{ color: '#999' }}>not checked</span>
                  : typeof value === 'number' ? <strong>{value.toFixed(1)}</strong>
                  : <strong style={{ color: value ? 'green' : 'red' }}>{value ? 'YES' : 'NO'}</strong>}
        </p>
      ))}
    </div>
  );
}

function FE1View({ result }: { result: FE1Result }) {
  return (
    <div>
      <h3>Face Embedding</h3>
      <p>Vector dimensions: <strong>{result.faceVector.length}</strong></p>
      <p style={{ fontSize: 12, color: '#666' }}>
        First 8 values: [{result.faceVector.slice(0, 8).map(v => v.toFixed(4)).join(', ')}…]
      </p>
    </div>
  );
}
