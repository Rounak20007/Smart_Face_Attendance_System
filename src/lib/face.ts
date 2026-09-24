// Client-only face-api.js helpers for facial recognition and matching.
// This module handles loading face detection models and comparing facial descriptors
// to identify enrolled individuals. Functions are designed to be imported dynamically
// from client components to avoid server-side rendering issues.
const MODEL_URL = "https://justadudewhohacks.github.io/face-api.js/models";

let loadPromise: Promise<typeof import("face-api.js")> | null = null;

/**
 * Loads and initializes the face-api.js models required for face detection and recognition.
 * This function ensures models are only loaded once, even if called multiple times.
 * 
 * @returns Promise that resolves to the face-api.js module with loaded models
 * 
 * @notes Loads three models:
 *   - tinyFaceDetector: For fast face detection
 *   - faceLandmark68Net: For facial landmark detection (needed for descriptors)
 *   - faceRecognitionNet: For generating 128-dimensional face descriptors
 */
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

/**
 * Checks if the face-api.js models have been loaded.
 * 
 * @returns true if models are loaded or loading, false otherwise
 */
export function isFaceApiLoaded() {
  return loadPromise !== null;
}

/**
 * Calculates the Euclidean distance between two numerical arrays.
 * Used to compare similarity between face descriptors (128-dimensional vectors).
 * 
 * @param a - First numerical array
 * @param b - Second numerical array
 * @returns The Euclidean distance between the arrays
 * 
 * @notes Lower distance indicates higher similarity. Face recognition typically
 *        uses a threshold (e.g., 0.5) to determine if two descriptors match.
 */
export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Represents an enrolled person with their facial descriptor data.
 */
export type EnrolledPerson = {
  /** Unique identifier for the person */
  id: string;
  /** Display name of the person */
  name: string;
  /** Array of facial descriptor vectors (each is typically 128-dimensional) */
  descriptors: number[][];
};

/**
 * Finds the best matching enrolled person for a given face descriptor.
 * Compares the input descriptor against all stored descriptors for each person
 * and returns the person with the smallest distance, if within threshold.
 * 
 * @param descriptor - The face descriptor to match (128-dimensional Float32Array)
 * @param people - Array of enrolled people to search through
 * @param threshold - Maximum distance for a match (default: 0.5)
 * @returns Object containing the matched person and distance, or null if no match within threshold
 * 
 * @notes The algorithm:
 *   1. Converts Float32Array to regular array for easier manipulation
 *   2. Iterates through all people and all their descriptors
 *   3. Tracks the person with minimum distance
 *   4. Returns match only if distance <= threshold
 */
export function bestMatch(
  descriptor: Float32Array,
  people: EnrolledPerson[],
  threshold = 0.5,
): { person: EnrolledPerson; distance: number } | null {
  // Convert Float32Array to regular array for easier manipulation
  const descriptorArray = Array.from(descriptor);
  let bestMatch: { person: EnrolledPerson; distance: number } | null = null;
  
  // Check each enrolled person
  for (const person of people) {
    // Check each descriptor for this person (people can have multiple samples)
    for (const personDescriptor of person.descriptors) {
      const distance = euclidean(descriptorArray, personDescriptor);
      
      // Update best match if this is closer than any previous match
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { person, distance };
      }
    }
  }
  
  // Return match only if within acceptable threshold
  if (bestMatch && bestMatch.distance <= threshold) {
    return bestMatch;
  }
  
  return null;
}
