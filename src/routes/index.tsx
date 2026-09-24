import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadFaceApi, bestMatch, type EnrolledPerson } from "@/lib/face";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, Loader2, Play, Square, CheckCircle2, Plus, X } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FaceMark — Multi-Camera Attendance" },
      { name: "description", content: "Point cameras at people to automatically mark their attendance across multiple feeds." },
      { property: "og:title", content: "FaceMark — Multi-Camera Attendance" },
      { property: "og:description", content: "Automatic face-recognition attendance with multi-camera tracking." },
    ],
  }),
  component: AttendancePage,
});

type Recognition = {
  key: string;
  name: string;
  distance: number;
  time: string;
  snapshotUrl?: string;
};

const COOLDOWN_MS = 30_000; // 30 second cooldown per person per camera
const TRACK_IOU_THRESHOLD = 0.3;
const MAX_TRACK_AGE_MS = 2000; // 2 second track timeout
const DETECTION_INTERVAL_MS = 500; // throttle AI detection to avoid running on every animation frame\n  const ERROR_THRESHOLD = 5; // Maximum consecutive errors before pausing processing\n  const RECOVERY_TIME_MS = 2000; // Time to pause processing after error threshold reached (ms)

function AttendancePage() {
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  const [people, setPeople] = useState<EnrolledPerson[]>([]);
  const [recent, setRecent] = useState<Recognition[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "running">("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [deviceInfos, setDeviceInfos] = useState<MediaDeviceInfo[]>([]);
  const [newCameraLabel, setNewCameraLabel] = useState("");
  const [newCameraDeviceId, setNewCameraDeviceId] = useState("");
  const lastMarkedRef = useRef<Record<string, number>>({}); // personId:cameraLabel -> timestamp
  const lastDetectionRef = useRef<Record<string, number>>({});
  const nextTrackIdRef = useRef\(0\);\n    const errorCountRef = useRef<Record<string, number>>({});

  const createCameraConfig = useCallback((label: string, deviceId: string | null): CameraConfig => ({
    id: `cam-${Date.now()}-${Math.random()}`,
    label,
    deviceId,
    videoRef: { current: null },
    canvasRef: { current: null },
    overlayRef: { current: null },
    runningRef: { current: false },
    tracks: [],
  }), []);

  // Enumerate video input devices
  useEffect(() => {
    async function enumerate() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const video = devices.filter((d) => d.kind === "videoinput");
        setDeviceInfos(video);
        // Initialize with first available camera if none configured
        if (cameras.length === 0 && video.length > 0) {
          setCameras([createCameraConfig(video[0].label || "Camera 1", video[0].deviceId)]);
        }
      } catch (e) {
        console.error("Error enumerating devices:", e);
        toast.error("Could not access cameras");
      }
    }
    enumerate();
  }, [cameras.length]);

  const addCamera = () => {
    if (deviceInfos.length === 0) {
      toast.error("No video input devices found");
      return;
    }
    const selectedDevice = deviceInfos.find((device) => device.deviceId === newCameraDeviceId) ?? deviceInfos[0];
    setCameras((prev) => [
      ...prev,
      createCameraConfig(
        newCameraLabel.trim() || selectedDevice.label || `Camera ${prev.length + 1}`,
        selectedDevice.deviceId,
      ),
    ]);
    setNewCameraLabel("");
  };

  const removeCamera = (id: string) => {
    const removedCam = cameras.find(cam => cam.id === id);
    if (removedCam?.videoRef.current) {
      const stream = removedCam.videoRef.current.srcObject as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
      removedCam.videoRef.current.srcObject = null;
    }
    setCameras(prev => prev.filter(cam => cam.id !== id));
  };

  const loadPeople = useCallback(async () => {
    setStatus("loading");
    setStatusText("Loading enrolled people...");
    try {
      const { data, error } = await supabase.from("people").select("id, name, descriptors");
      if (error) throw error;
      const peopleList: EnrolledPerson[] = (data ?? []).map(p => ({
        id: p.id,
        name: p.name,
        descriptors: p.descriptors as number[][],
      }));
      setPeople(peopleList);
      if (peopleList.length === 0) {
        toast.message("No enrolled people yet.", { description: "Add some in the Enroll tab." });
      }
      setStatusText("Ready");
    } catch (e) {
      console.error(e);
      toast.error("Could not load people", { description: (e as Error).message });
      setStatus("idle");
      setStatusText("Error");
    }
  }, []);

  useEffect(() => {
    loadPeople();
  }, [loadPeople]);

  // IoU helper for tracking
  function iou(boxA: [number, number, number, number], boxB: [number, number, number, number]): number {
    const [xA, yA, wA, hA] = boxA;
    const [xB, yB, wB, hB] = boxB;
    const interX = Math.max(xA, xB);
    const interY = Math.max(yA, yB);
    const interW = Math.min(xA + wA, xB + wB) - interX;
    const interH = Math.min(yA + hA, yB + hB) - interY;
    if (interW <= 0 || interH <= 0) return 0;
    const interArea = interW * interH;
    const areaA = wA * hA;
    const areaB = wB * hB;
    return interArea / (areaA + areaB - interArea);
  }

  // Process a single camera stream
  const processCamera = useCallback(
    async (cam: CameraConfig) => {
      if (!cam.runningRef.current) return;
      try {
        const faceapi = await loadFaceApi();
        const v = cam.videoRef.current;
        if (!v || !v.srcObject) return;

        const videoWidth = v.videoWidth || 640;
        const videoHeight = v.videoHeight || 480;

        const overlay = cam.overlayRef.current!;
        overlay.width = videoWidth;
        overlay.height = videoHeight;
        const octx = overlay.getContext("2d")!;
        const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 });

        const loop = async () => {
          if (!cam.runningRef.current) return;

          const now = Date.now();
          const lastDetectedAt = lastDetectionRef.current[cam.id] ?? 0;
          if (now - lastDetectedAt < DETECTION_INTERVAL_MS) {
            if (cam.runningRef.current) requestAnimationFrame(loop);
            return;
          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
          lastDetectionRef.current[cam.id] = now;

          try {
            const results = await faceapi
              .detectAllFaces(v, detectorOpts)
              .withFaceLandmarks()
              .withFaceDescriptors();

            octx.clearRect(0, 0, overlay.width, overlay.height);
            // Age tracks and remove stale ones
            cam.tracks.forEach(t => (t.age += 1000 / 30)); // ~30fps
            cam.tracks = cam.tracks.filter(t => t.age < MAX_TRACK_AGE_MS);

            const usedTracks = new Set<number>();
            const usedDetections = new Set<number>();

            // Match detections to existing tracks
            for (let dIdx = 0; dIdx < results.length; dIdx++) {
              const det = results[dIdx];
              const detBox: [number, number, number, number] = [
                det.detection.box.x,
                det.detection.box.y,
                det.detection.box.width,
                det.detection.box.height,
              ];
              let bestTi = -1;
              let bestIou = 0;

              for (let tIdx = 0; tIdx < cam.tracks.length; tIdx++) {
                if (usedTracks.has(tIdx)) continue;
                const tr = cam.tracks[tIdx];
                const trBox: [number, number, number, number] = [tr.x, tr.y, tr.w, tr.h];
                const i = iou(detBox, trBox);
                if (i > bestIou && i > TRACK_IOU_THRESHOLD) {
                  bestIou = i;
                  bestTi = tIdx;
                }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
              }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;

              if (bestTi >= 0) {
                // Update existing track
                const tr = cam.tracks[bestTi];
                tr.x = detBox[0];
                tr.y = detBox[1];
                tr.w = detBox[2];
                tr.h = detBox[3];
                tr.age = 0;
                usedTracks.add(bestTi);
                usedDetections.add(dIdx);

                // Check recognition
                const match = bestMatch(det.descriptor, people, 0.5);
                if (match) {
                  tr.name = match.person.name;
                  tr.distance = match.distance;
                }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0; else {
                  tr.name = null;
                  tr.distance = null;
                }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
              }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
            }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;

            // Create new tracks for unmatched detections
            for (let dIdx = 0; dIdx < results.length; dIdx++) {
              if (usedDetections.has(dIdx)) continue;
              const det = results[dIdx];
              const detBox: [number, number, number, number] = [
                det.detection.box.x,
                det.detection.box.y,
                det.detection.box.width,
                det.detection.box.height,
              ];
              const match = bestMatch(det.descriptor, people, 0.5);
              cam.tracks.push({
                id: nextTrackIdRef.current++,
                x: detBox[0],
                y: detBox[1],
                w: detBox[2],
                h: detBox[3],
                age: 0,
                name: match ? match.person.name : null,
                distance: match ? match.distance : null,
                logged: false,
              }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;);
            }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;

            // Render tracks and handle attendance logging
            for (const tr of cam.tracks) {
              const { x, y, w, h } = tr;
              const isKnown = tr.name !== null;

              // Draw bounding box
              octx.lineWidth = 2;
              octx.strokeStyle = isKnown ? "#22c55e" : "#ef4444";
              octx.strokeRect(x, y, w, h);

              // Draw label background
              const label = isKnown ? `${tr.name} (${tr.distance?.toFixed(2) ?? "?"})` : "Unknown";
              const tw = octx.measureText(label).width + 10;
              octx.fillStyle = isKnown ? "#22c55e" : "#ef4444";
              octx.fillRect(x, y - 20, tw, 20);

              // Draw label text
              octx.fillStyle = "#0b0f19";
              octx.fillText(label, x + 5, y - 5);

              // Handle attendance logging for recognized persons
              if (isKnown && tr.name && !tr.logged) {
                const person = people.find(p => p.name === tr.name);
                if (person) {
                  const key = `${person.id}:${cam.label}`;
                  const now = Date.now();
                  const last = lastMarkedRef.current[key];

                  if (!last || now - last >= COOLDOWN_MS) {
                    lastMarkedRef.current[key] = now;

                    // Capture snapshot
                    const snap = cam.canvasRef.current;
                    if (v && snap) {
                      snap.width = videoWidth;
                      snap.height = videoHeight;
                      const ctx = snap.getContext("2d");
                      ctx?.drawImage(v, 0, 0);
                      const blob = await new Promise<Blob | null>((resolve) =>
                        snap.toBlob(resolve, "image/jpeg", 0.8),
                      );

                      if (blob) {
                        const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.jpg`;
                        const { error: upErr } = await supabase.storage
                          .from("attendance-snapshots")
                          .upload(path, blob, { contentType: "image/jpeg" });

                        if (!upErr) {
                          const { data: signed } = await supabase.storage
                            .from("attendance-snapshots")
                            .createSignedUrl(path, 60 * 60 * 24 * 7);

                          await supabase.from("attendance").insert({
                            person_id: person.id,
                            person_name: person.name,
                            camera_label: cam.label,
                            snapshot_url: path,
                          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;);

                          // Update UI
                          setRecent(prev => [{
                            key: `${person.id}:${now}`,
                            name: person.name,
                            distance: tr.distance ?? 0,
                            time: new Date().toLocaleTimeString(),
                            snapshotUrl: signed?.signedUrl,
                          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;, ...prev.slice(0, 7)]);

                          toast.success(`Marked ${person.name}`, {
                            description: `${cam.label} · ${new Date().toLocaleTimeString()}`
                          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;);
                        }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
                      }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
                    }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
                    tr.logged = true;
                  }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
                }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
              }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;

              // Reset logged flag if person becomes unrecognized (optional)
              if (!isKnown) {
                tr.logged = false;
              }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
            }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0; catch (err) {
            // TEST REPLACEMENT
          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;

          if (cam.runningRef.current) requestAnimationFrame(loop);
        };

        loop();
      } catch (e) {
        console.error("Error initializing camera:", e);
        toast.error("Camera error", { description: (e as Error).message });
        cam.runningRef.current = false;
      }
    },
    [people]
  );

  // Start all cameras
  const startAll = useCallback(async () => {
    if (cameras.length === 0) {
      toast.error("No cameras configured");
      return;
    }
    setStatus("loading");
    setStatusText("Starting cameras...");

    try {
      // Ensure people data is loaded
      if (people.length === 0) await loadPeople();

      // Preload detection models once before opening any camera stream.
      await loadFaceApi();

      // Initialize each camera
      await Promise.all(
        cameras.map(async (cam) => {
          try {
            let stream: MediaStream;
            if (cam.deviceId) {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: cam.deviceId }, width: 640, height: 480 },
                audio: false,
              }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;);
            }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0; else {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: false
              }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;);
            }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;

            cam.videoRef.current!.srcObject = stream;
            await cam.videoRef.current!.play();
            cam.runningRef.current = true;
          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0; catch (err) {
            console.error(`Error starting camera ${cam.id}:`, err);
            toast.error(`Failed to start camera ${cam.label}`);
            cam.runningRef.current = false;
          }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;
        })
      );

      // Start processing loops for all running cameras
      cameras.forEach(cam => {
        if (cam.videoRef.current && cam.videoRef.current.srcObject) {
          processCamera(cam);
        }
      });

      setStatus("running");
      setStatusText(`Streaming ${cameras.length} camera${cameras.length > 1 ? "s" : ""}`);
    } catch (e) {
      console.error(e);
      toast.error("Could not start cameras", { description: (e as Error).message });
      setStatus("idle");
      setStatusText("Error");
    }
  }, [cameras, people, loadPeople, processCamera]);

  // Stop all cameras
  const stopAll = useCallback(() => {
    cameras.forEach(cam => {
      cam.runningRef.current = false;
      const video = cam.videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
      if (video) {
        video.srcObject = null;
      }
    });
    setStatus("idle");
    setStatusText("Stopped");
  }, [cameras]);

  useEffect(() => () => stopAll(), [stopAll]);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Multi-Camera Attendance System</h1>
          <p className="text-muted-foreground mt-1">
            Real-time face recognition across multiple camera feeds with tracking and attendance logging.
          </p>
          <p className="text-sm text-muted-foreground mt-2" aria-live="polite">
            Status: {statusText}
          </p>
        </div>

        {/* Camera Controls */}
        <div className="grid gap-4 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:gap-4">
            <div className="flex-1 min-w-[220px]">
              <Label htmlFor="cam-label">Camera label (for new)</Label>
              <Input
                id="cam-label"
                placeholder="e.g. Main Entrance"
                value={newCameraLabel}
                onChange={(event) => setNewCameraLabel(event.target.value)}
              />
            </div>
            <div className="flex-1 flex-sm-col sm:w-48">
              <Button onClick={addCamera} disabled={status === "running"} className="w-full">
                {status === "loading" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add camera
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start sm:gap-4">
            <div className="flex-1">
              {deviceInfos.length > 0 ? (
                <>
                  <Label>Default device for new cameras</Label>
                  <select
                    value={newCameraDeviceId}
                    onChange={(event) => setNewCameraDeviceId(event.target.value)}
                  >
                    <option value="">Use system default</option>
                    {deviceInfos.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Device ${d.deviceId}`}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="text-muted-foreground">No video devices detected</p>
              )}
            </div>
            <div className="flex-1">
              {status !== "running" ? (
                <Button onClick={startAll} disabled={status === "loading"} className="w-full">
                  {status === "loading" ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Start all
                </Button>
              ) : (
                <Button variant="destructive" onClick={stopAll} className="w-full">
                  <Square className="h-4 w-4 mr-2" /> Stop all
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Camera Feeds */}
        <div className="grid gap-4">
          {cameras.map(cam => (
            <div key={cam.id} className="border rounded-lg overflow-hidden bg-black">
              {/* Camera Controls */}
              <div className="flex items-start gap-3 p-3">
                <div className="flex-shrink-0">
                  <Input
                    value={cam.label}
                    onChange={(e) => {
                      setCameras(prev => prev.map(c =>
                        c.id === cam.id ? { ...c, label: e.target.value } : c
                      ));
                    }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;}
                    placeholder="Camera label"
                    className="w-48"
                    disabled={cam.runningRef.current}
                  />
                </div>
                <div className="flex-1">
                  {deviceInfos.length > 0 ? (
                    <select
                      value={cam.deviceId ?? ""}
                      onChange={(e) => {
                        setCameras(prev => prev.map(c =>
                          c.id === cam.id
                            ? { ...c, deviceId: e.target.value === "" ? null : e.target.value }
                            : c
                        ));
                      }\n        // Reset error count on successful processing\n        errorCountRef.current[cam.id] = 0;}
                    >
                      <option value="">Use system default</option>
                      {deviceInfos.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Device ${d.deviceId}`}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm text-muted-foreground">No video devices</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCamera(cam.id)}
                  disabled={status === "running"}
                  aria-label={`Remove ${cam.label}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Video Feed */}
              <div className="relative overflow-hidden aspect-video w-full">
                <video
                  ref={cam.videoRef}
                  className="absolute inset-0 h-full w-full object-contain"
                  playsInline
                  muted
                />
                <canvas
                  ref={cam.overlayRef}
                  className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                />
                {cam.runningRef.current === false && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                    <Camera className="h-10 w-10 mb-2" />
                    <p>Camera off</p>
                  </div>
                )}
              </div>

              {/* Hidden Canvas for Snapshots */}
              <canvas ref={cam.canvasRef} className="hidden" />

              {/* Camera Status */}
              <div className="flex items-center gap-3 px-3 pt-2 text-sm text-muted-foreground">
                <span>Status:{cam.runningRef.current ? (
                  <span className="ml-1 text-foreground font-medium">Running</span>
                ) : (
                  <span className="ml-1 text-muted-foreground">Stopped</span>
                )}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Recognitions Sidebar */}
        <aside className="mt-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent recognitions
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="space-y-2">
              {recent.map(r => (
                <li key={r.key} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                  <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.time} · d={r.distance.toFixed(2)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </main>
    </div>
  );
}

// Camera configuration type
interface CameraConfig {
  id: string;
  label: string;
  deviceId: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  runningRef: RefObject<boolean>;
  tracks: Track[];
}

// Track object for IoU-based tracking
interface Track {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  age: number; // milliseconds since last update
  name: string | null;
  distance: number | null;
  logged: boolean;
}
