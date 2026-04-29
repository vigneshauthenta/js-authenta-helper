import { NextRequest, NextResponse } from 'next/server';
import { AuthentaClient, ModelType, FI1Metadata, ModelResult } from '@/lib/authenta-client';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const file      = form.get('file')           as File | null;
    const modelType = form.get('modelType')      as ModelType | null;
    const refImage  = form.get('referenceImage') as File | null;

    if (!file)      return NextResponse.json({ error: 'Missing file'      }, { status: 400 });
    if (!modelType) return NextResponse.json({ error: 'Missing modelType' }, { status: 400 });

    if (!['DF-1', 'FI-1', 'FE-1'].includes(modelType)) {
      return NextResponse.json({ error: `Invalid modelType: ${modelType}` }, { status: 400 });
    }

    const fileBuffer = await file.arrayBuffer();

    let referenceBuffer: ArrayBuffer | undefined;
    let referenceContentType: string | undefined;
    let metadata: FI1Metadata | undefined;

    if (modelType === 'FI-1') {
      const flag = (key: string) => form.get(key) === 'true';

      metadata = {
        isSingleFace:        true,
        faceswapCheck:       flag('faceswapCheck'),
        livenessCheck:       flag('livenessCheck'),
        faceSimilarityCheck: flag('faceSimilarityCheck'),
      };

      if (refImage && metadata.faceSimilarityCheck) {
        referenceBuffer      = await refImage.arrayBuffer();
        referenceContentType = refImage.type || 'image/jpeg';
      }
    }

    const authenta = new AuthentaClient();

    const { mid, result } = await authenta.uploadAndWait<ModelResult>({
      name:        file.name,
      fileBuffer,
      contentType: file.type,
      modelType,
      referenceBuffer,
      referenceContentType,
      metadata,
    });

    return NextResponse.json({ mid, result });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[/api/analyse]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
