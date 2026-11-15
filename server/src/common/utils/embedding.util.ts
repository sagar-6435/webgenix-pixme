export type Embedding = ArrayLike<number>;

export interface EventFace {
  photoId: string;
  faceId: string;
  embedding: Embedding;
  confidence?: number;
}

export interface PhotoMatch {
  photoId: string;
  distance: number;
  confidence: number;
}

export function euclideanDistance(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = a[i] - b[i];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Match one selfie against every indexed face in an event. A photograph can
 * contain several faces; the closest face determines the photo's distance.
 * Distances above the threshold are discarded — uncertain matches must never
 * be presented as confirmed matches.
 */
export function aggregatePhotoMatches(
  faces: EventFace[],
  selfie: Embedding,
  threshold: number,
  maxResults = 500,
): PhotoMatch[] {
  const bestByPhoto = new Map<string, PhotoMatch>();

  for (const face of faces) {
    const distance = euclideanDistance(face.embedding, selfie);
    if (!Number.isFinite(distance) || distance > threshold) continue;

    const previous = bestByPhoto.get(face.photoId);
    if (!previous || distance < previous.distance) {
      bestByPhoto.set(face.photoId, {
        photoId: face.photoId,
        distance,
        confidence: Math.round(Math.max(0, Math.min(1, 1 - distance)) * 10000) / 10000,
      });
    }
  }

  return Array.from(bestByPhoto.values())
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults);
}

/** Validate that an embedding is finite and not a degenerate zero vector. */
export function isUsableEmbedding(values: ArrayLike<number>, expectedDim = 128): boolean {
  if (values.length !== expectedDim) return false;
  let norm = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i])) return false;
    norm += values[i] * values[i];
  }
  return norm > 1e-6;
}
