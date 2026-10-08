import { useCallback, useRef, useState, useEffect } from "react";

export interface UseCameraOptions {
  width?: number;
  height?: number;
  deviceId?: string;
}

export interface UseCameraReturn {
  stream: MediaStream | null;
  error: string | null;
  isLoading: boolean;
  isActive: boolean;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  startCamera: (deviceId?: string) => Promise<void>;
  stopCamera: () => void;
  setDevice: (deviceId: string) => void;
}

export function useCamera({
  width = 640,
  height = 480,
  deviceId: initialDeviceId,
}: UseCameraOptions = {}): UseCameraReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(initialDeviceId || null);

  const streamRef = useRef<MediaStream | null>(null);

  const enumerateDevices = useCallback(async () => {
    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = deviceList.filter((d) => d.kind === "videoinput");
      setDevices(videoDevices);

      // Auto-select first device if none selected and list is available
      if (!selectedDeviceId && videoDevices.length > 0) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }

      return videoDevices;
    } catch (err) {
      setError(`Failed to enumerate devices: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }, [selectedDeviceId]);

  useEffect(() => {
    enumerateDevices();
  }, [enumerateDevices]);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      const targetDeviceId = deviceId || selectedDeviceId;

      if (isLoading || isActive) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Stop existing stream if any
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }

        const constraints: MediaStreamConstraints = {
          video: targetDeviceId
            ? { deviceId: { exact: targetDeviceId }, width, height }
            : { width, height },
          audio: false,
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = mediaStream;
        setStream(mediaStream);
        setIsActive(true);

        // Update selected device ID if starting with explicit device
        if (deviceId) {
          setSelectedDeviceId(deviceId);
        }
      } catch (err) {
        setError(`Failed to start camera: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, isActive, selectedDeviceId, width, height]
  );

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setStream(null);
    setIsActive(false);
    setError(null);
  }, []);

  const setDevice = useCallback((deviceId: string) => {
    if (isActive) {
      // If camera is active, restart with new device
      stopCamera();
      setSelectedDeviceId(deviceId);
      setTimeout(() => startCamera(deviceId), 100);
    } else {
      setSelectedDeviceId(deviceId);
    }
  }, [isActive, startCamera, stopCamera]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Listen for device changes
  useEffect(() => {
    const handleDeviceChange = () => {
      enumerateDevices();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [enumerateDevices]);

  return {
    stream,
    error,
    isLoading,
    isActive,
    devices,
    selectedDeviceId,
    startCamera,
    stopCamera,
    setDevice,
  };
}
