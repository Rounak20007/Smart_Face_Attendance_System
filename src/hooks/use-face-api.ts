import { useState, useCallback, useEffect } from "react";
import { loadFaceApi, isFaceApiLoaded } from "@/lib/face";

export interface UseFaceApiReturn {
  isLoading: boolean;
  error: string | null;
  isLoaded: boolean;
  loadModels: () => Promise<void>;
  api: Awaited<ReturnType<typeof loadFaceApi>> | null;
}

export function useFaceApi(): UseFaceApiReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [api, setApi] = useState<Awaited<ReturnType<typeof loadFaceApi>> | null>(null);

  const loadModels = useCallback(async () => {
    if (isLoaded || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const faceApi = await loadFaceApi();
      setApi(faceApi);
      setIsLoaded(true);
    } catch (err) {
      setError(`Failed to load face recognition models: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, isLoading]);

  // Preload models on mount if not already loaded
  useEffect(() => {
    if (!isFaceApiLoaded() && !isLoading && !isLoaded) {
      loadModels();
    }
  }, [loadModels, isLoading, isLoaded]);

  return {
    isLoading,
    error,
    isLoaded,
    loadModels,
    api,
  };
}
