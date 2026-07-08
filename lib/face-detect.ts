import 'server-only';

/**
 * Self-hosted face DETECTION + EMBEDDING engine. Everything here runs on
 * Advottic infrastructure; no biometric vector is ever sent to a third-party
 * face API (no AWS Rekognition / Azure Face / Google Vision). See
 * docs/face-detection-spike.md for the placement rationale.
 *
 * IMPORTANT framing: this engine answers "does the same face recur across these
 * photos?" It produces boxes + embeddings + distance-based groups. It NEVER
 * asserts who a person is. Identity is not a concept here.
 *
 * The model backend (@vladmandic/face-api on the tf.js WASM backend, decoding
 * images with @napi-rs/canvas, loading self-hosted weights from FACE_MODELS_DIR)
 * is an OPTIONAL, runtime-only dependency. When it is not provisioned, every
 * function here FAILS CLOSED to an empty result, so the feature simply finds no
 * faces and the build stays green. To turn on real inference, follow the
 * "To fully enable" steps in the spike doc.
 */

/** Normalised bounding box in 0..1 image coordinates, plus detector confidence. */
export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  score?: number;
};

/** One detected face: where it is, and its self-hosted embedding. */
export type DetectedFace = {
  bbox: FaceBox;
  embedding: number[];
};

type FaceBackend = {
  detect(buffer: Buffer, mime: string): Promise<DetectedFace[]>;
};

// Loaded once per server instance. `null` means "not provisioned / unavailable"
// and is cached so we don't retry the import on every image.
let backendPromise: Promise<FaceBackend | null> | null = null;

async function loadBackend(): Promise<FaceBackend | null> {
  const modelsDir = process.env.FACE_MODELS_DIR?.trim();
  // No self-hosted weights configured => the feature is not provisioned. Fail
  // closed to a no-op rather than reaching for any hosted service.
  if (!modelsDir) return null;

  try {
    // Literal specifiers + webpackIgnore so the bundler leaves these as runtime
    // imports; the ambient decls in types/optional-face-deps.d.ts keep tsc happy
    // even though the packages aren't installed until the feature is enabled.
    const faceapi = await import(/* webpackIgnore: true */ '@vladmandic/face-api');
    const canvas = await import(/* webpackIgnore: true */ '@napi-rs/canvas');

    // face-api needs a DOM-ish environment; give it @napi-rs/canvas's primitives.
    faceapi.env.monkeyPatch({
      Canvas: canvas.Canvas,
      Image: canvas.Image,
      ImageData: canvas.ImageData,
      createCanvasElement: () => canvas.createCanvas(1, 1),
      createImageElement: () => new canvas.Image(),
    });

    // tf.js WASM backend (no native tfjs-node binary; deployable on serverless).
    if (faceapi.tf?.setBackend) {
      await faceapi.tf.setBackend('wasm').catch(() => {});
      await faceapi.tf.ready?.();
    }

    // Load self-hosted weights from disk: a light detector + the 128-d descriptor.
    await faceapi.nets.tinyFaceDetector.loadFromDisk(modelsDir);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsDir);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsDir);

    const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });

    return {
      async detect(buffer: Buffer): Promise<DetectedFace[]> {
        const img = await canvas.loadImage(buffer);
        const w = img.width || 1;
        const h = img.height || 1;
        const results = await faceapi
          .detectAllFaces(img as unknown as HTMLImageElement, detectorOpts)
          .withFaceLandmarks()
          .withFaceDescriptors();
        return (results ?? [])
          .filter((r: { descriptor?: Float32Array }) => r.descriptor && r.descriptor.length)
          .map((r: { detection: { box: { x: number; y: number; width: number; height: number }; score: number }; descriptor: Float32Array }) => {
            const b = r.detection.box;
            return {
              bbox: {
                x: clamp01(b.x / w),
                y: clamp01(b.y / h),
                width: clamp01(b.width / w),
                height: clamp01(b.height / h),
                score: r.detection.score,
              },
              embedding: Array.from(r.descriptor),
            };
          });
      },
    };
  } catch {
    // Any missing dep / model / runtime error => no-op, never a hosted fallback.
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Detect faces in one image's bytes and return their boxes + embeddings.
 * Returns [] when the self-hosted model is not provisioned or the image can't be
 * read. Only ever called AFTER the firm opt-in has been checked by the caller.
 */
export async function detectFaces(buffer: Buffer, mime: string): Promise<DetectedFace[]> {
  // Cheap guard: only raster images carry faces we can decode.
  if (!/^image\/(jpeg|png|webp)$/i.test(mime)) return [];
  if (!backendPromise) backendPromise = loadBackend();
  const backend = await backendPromise;
  if (!backend) return [];
  try {
    return await backend.detect(buffer, mime);
  } catch {
    return [];
  }
}

/** Cosine distance (0 = identical direction, 2 = opposite) between two vectors. */
export function cosineDistance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 2;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 2;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type ClusterInput = { id: string; embedding: number[] };

/**
 * Greedy single-link clustering by cosine distance: each face joins the nearest
 * existing cluster whose centroid is within `threshold`, else it starts a new
 * cluster. Deterministic given a stable input order. Returns, for each cluster,
 * the member face ids. This is "these crops look like the same face", NOT an
 * identity resolution - callers can merge/split afterwards.
 *
 * A cosine distance of ~0.4 is a reasonable default for 128-d face-api
 * descriptors; expose it so it can be tuned per deployment.
 */
export function clusterFaces(faces: ClusterInput[], threshold = 0.4): string[][] {
  const clusters: { centroid: number[]; count: number; members: string[] }[] = [];
  for (const face of faces) {
    if (!face.embedding?.length) continue;
    let best = -1;
    let bestDist = threshold;
    for (let i = 0; i < clusters.length; i++) {
      const d = cosineDistance(face.embedding, clusters[i].centroid);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best === -1) {
      clusters.push({ centroid: [...face.embedding], count: 1, members: [face.id] });
    } else {
      const c = clusters[best];
      // Running-average centroid so the cluster stays representative as it grows.
      for (let i = 0; i < c.centroid.length; i++) {
        c.centroid[i] = (c.centroid[i] * c.count + face.embedding[i]) / (c.count + 1);
      }
      c.count += 1;
      c.members.push(face.id);
    }
  }
  return clusters.map((c) => c.members);
}
