// Client-only face-api.js helpers. Import dynamically from client components.
const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

let loadPromise: Promise<typeof import("face-api.js")> | null = null;

export async function loadFaceApi() {
  if (!loadPromise) {
    loadPromise = (async () => {
      const faceapi = await import("face-api.js");
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })();
  }
  return loadPromise;
}

export function isFaceApiLoaded() {
  return loadPromise !== null;
}

export function euclidean(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

export type EnrolledPerson = {
  id: string;
  name: string;
  descriptors: number[][];
};

export function bestMatch(
  descriptor: Float32Array,
  people: EnrolledPerson[],
  threshold = 0.5,
): { person: EnrolledPerson; distance: number } | null {
  const arr = Array.from(descriptor);
  let best: { person: EnrolledPerson; distance: number } | null = null;
  for (const p of people) {
    for (const d of p.descriptors) {
      const dist = euclidean(arr, d);
      if (!best || dist < best.distance) best = { person: p, distance: dist };
    }
  }
  if (best && best.distance <= threshold) return best;
  return null;
}
