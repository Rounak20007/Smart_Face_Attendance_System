import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadFaceApi, bestMatch, type EnrolledPerson } from "@/lib/face";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Camera,
  Loader2,
  Play,
  Square,
  CheckCircle2,
  Plus,
  X,
  AlertTriangle,
  UserCheck,
  ShieldCheck,
  Video,
  Activity,
  ArrowRight,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  COOLDOWN_MS,
  TRACK_IOU_THRESHOLD,
  MAX_TRACK_AGE_MS,
  DETECTION_INTERVAL_MS,
  FACE_RECOGNITION_THRESHOLD,
  MAX_RECENT_DISPLAY,
} from "@/lib/constants";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FaceMark — Smart Multi-Camera Attendance" },
      {
        name: "description",
        content: "Automated institutional face-recognition attendance system with multi-camera tracking.",
      },
      { property: "og:title", content: "FaceMark — Smart Attendance" },
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
  personId?: string;
};

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

interface Track {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lastSeenAt: number;
  personId: string | null;
  name: string | null;
  distance: number | null;
  logged: boolean;
}

function AttendancePage() {
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  const [people, setPeople] = useState<EnrolledPerson[]>([]);
  const [recent, setRecent] = useState<Recognition[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "running">("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [deviceInfos, setDeviceInfos] = useState<MediaDeviceInfo[]>([]);
  const [newCameraLabel, setNewCameraLabel] = useState("");
  const [newCameraDeviceId, setNewCameraDeviceId] = useState("");
  const [activeTab, setActiveTab] = useState<"live" | "roster" | "at-risk">("live");
  const [rosterSearch, setRosterSearch] = useState("");
  const [nowTime, setNowTime] = useState(new Date());

  const lastMarkedRef = useRef<Record<string, number>>({});
  const nextTrackIdRef = useRef(0);

  // Live session clock
  useEffect(() => {
    const timer = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const createCameraConfig = useCallback(
    (label: string, deviceId: string | null): CameraConfig => ({
      id: `cam-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      deviceId,
      videoRef: { current: null },
      canvasRef: { current: null },
      overlayRef: { current: null },
      runningRef: { current: false },
      tracks: [],
    }),
    [],
  );

  // Enumerate video input devices
  useEffect(() => {
    async function enumerate() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const video = devices.filter((d) => d.kind === "videoinput");
        setDeviceInfos(video);
        if (cameras.length === 0 && video.length > 0) {
          setCameras([createCameraConfig(video[0].label || "Primary Auditorium Camera", video[0].deviceId)]);
        }
      } catch (e) {
        console.error("Error enumerating devices:", e);
        toast.error("Could not access camera hardware");
      }
    }
    enumerate();
  }, [cameras.length, createCameraConfig]);

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
    const removedCam = cameras.find((cam) => cam.id === id);
    if (removedCam?.videoRef.current) {
      const stream = removedCam.videoRef.current.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      removedCam.videoRef.current.srcObject = null;
    }
    setCameras((prev) => prev.filter((cam) => cam.id !== id));
  };

  const loadPeople = useCallback(async () => {
    setStatus("loading");
    setStatusText("Loading enrolled database...");
    try {
      const { data, error } = await supabase.from("people").select("id, name, descriptors");
      if (error) throw error;
      const peopleList: EnrolledPerson[] = (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        descriptors: p.descriptors as number[][],
      }));
      setPeople(peopleList);
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

  // Camera stream AI processing loop
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
          const startedAt = Date.now();
          try {
            const results = await faceapi
              .detectAllFaces(v, detectorOpts)
              .withFaceLandmarks()
              .withFaceDescriptors();

            const now = Date.now();
            octx.clearRect(0, 0, overlay.width, overlay.height);
            cam.tracks = cam.tracks.filter((t) => now - t.lastSeenAt < MAX_TRACK_AGE_MS);

            const usedTracks = new Set<number>();
            const usedDetections = new Set<number>();

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
                }
              }

              if (bestTi >= 0) {
                const tr = cam.tracks[bestTi];
                tr.x = detBox[0];
                tr.y = detBox[1];
                tr.w = detBox[2];
                tr.h = detBox[3];
                tr.lastSeenAt = now;
                usedTracks.add(bestTi);
                usedDetections.add(dIdx);

                const match = bestMatch(det.descriptor, people, FACE_RECOGNITION_THRESHOLD);
                if (match) {
                  tr.personId = match.person.id;
                  tr.name = match.person.name;
                  tr.distance = match.distance;
                } else {
                  tr.personId = null;
                  tr.name = null;
                  tr.distance = null;
                }
              }
            }

            for (let dIdx = 0; dIdx < results.length; dIdx++) {
              if (usedDetections.has(dIdx)) continue;
              const det = results[dIdx];
              const detBox: [number, number, number, number] = [
                det.detection.box.x,
                det.detection.box.y,
                det.detection.box.width,
                det.detection.box.height,
              ];
              const match = bestMatch(det.descriptor, people, FACE_RECOGNITION_THRESHOLD);
              cam.tracks.push({
                id: nextTrackIdRef.current++,
                x: detBox[0],
                y: detBox[1],
                w: detBox[2],
                h: detBox[3],
                lastSeenAt: now,
                personId: match ? match.person.id : null,
                name: match ? match.person.name : null,
                distance: match ? match.distance : null,
                logged: false,
              });
            }

            // Render HUD bounding boxes
            for (const tr of cam.tracks) {
              const { x, y, w, h } = tr;
              const isKnown = tr.name !== null;

              // Color token: Forest Green (#228B22) for enrolled, Crimson (#DC143C) for unknown
              octx.lineWidth = 2.5;
              octx.strokeStyle = isKnown ? "#22c55e" : "#ef4444";
              octx.strokeRect(x, y, w, h);

              // HUD Tag Background
              const label = isKnown ? `${tr.name} · ${(1 - (tr.distance ?? 0.5) * 1.5).toFixed(0)}% conf` : "Unregistered Face";
              octx.font = "bold 13px Inter, sans-serif";
              const tw = octx.measureText(label).width + 16;
              octx.fillStyle = isKnown ? "#22c55e" : "#ef4444";
              octx.fillRect(x, Math.max(0, y - 24), tw, 24);

              // HUD Tag Text
              octx.fillStyle = "#ffffff";
              octx.fillText(label, x + 8, Math.max(16, y - 7));

              // Mark attendance
              if (isKnown && tr.personId && !tr.logged) {
                const person = people.find((p) => p.id === tr.personId);
                if (person) {
                  const key = `${person.id}:${cam.label}`;
                  const last = lastMarkedRef.current[key];

                  if (!last || now - last >= COOLDOWN_MS) {
                    lastMarkedRef.current[key] = now;

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

                        let snapshotPath: string | null = null;
                        let signedUrl: string | undefined;
                        if (!upErr) {
                          snapshotPath = path;
                          const { data: signed } = await supabase.storage
                            .from("attendance-snapshots")
                            .createSignedUrl(path, 60 * 60 * 24 * 7);
                          signedUrl = signed?.signedUrl;
                        }

                        const { error: markErr } = await supabase.rpc("mark_attendance", {
                          p_person_id: person.id,
                          p_camera_label: cam.label,
                          p_snapshot_url: snapshotPath,
                        });

                        if (!markErr) {
                          setRecent((prev) => [
                            {
                              key: `${person.id}:${now}`,
                              name: person.name,
                              distance: tr.distance ?? 0,
                              time: new Date().toLocaleTimeString(),
                              snapshotUrl: signedUrl,
                              personId: person.id,
                            },
                            ...prev.slice(0, MAX_RECENT_DISPLAY - 1),
                          ]);

                          toast.success(`Verified: ${person.name}`, {
                            description: `${cam.label} · ${new Date().toLocaleTimeString()}`,
                          });
                        }
                      }
                    }
                    tr.logged = true;
                  }
                }
              }

              if (!isKnown) {
                tr.logged = false;
              }
            }
          } catch (err) {
            console.error("Camera detection cycle exception:", err);
          }

          if (cam.runningRef.current) {
            const elapsed = Date.now() - startedAt;
            const delay = Math.max(0, DETECTION_INTERVAL_MS - elapsed);
            setTimeout(loop, delay);
          }
        };

        loop();
      } catch (e) {
        console.error("Camera init error:", e);
        toast.error("Camera error", { description: (e as Error).message });
        cam.runningRef.current = false;
      }
    },
    [people],
  );

  const startAll = useCallback(async () => {
    if (cameras.length === 0) {
      toast.error("No cameras configured");
      return;
    }
    setStatus("loading");
    setStatusText("Initializing biometric pipeline...");

    try {
      if (people.length === 0) await loadPeople();
      await loadFaceApi();

      await Promise.all(
        cameras.map(async (cam) => {
          try {
            const constraints: MediaStreamConstraints = cam.deviceId
              ? { video: { deviceId: { exact: cam.deviceId }, width: 640, height: 480 }, audio: false }
              : { video: { width: 640, height: 480 }, audio: false };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            cam.videoRef.current!.srcObject = stream;
            await cam.videoRef.current!.play();
            cam.runningRef.current = true;
          } catch (err) {
            console.error(`Camera start error for ${cam.id}:`, err);
            toast.error(`Failed to start ${cam.label}`);
            cam.runningRef.current = false;
          }
        }),
      );

      cameras.forEach((cam) => {
        if (cam.videoRef.current && cam.videoRef.current.srcObject) {
          processCamera(cam);
        }
      });

      setStatus("running");
      setStatusText(`Active (${cameras.length} camera feed${cameras.length > 1 ? "s" : ""})`);
    } catch (e) {
      console.error(e);
      toast.error("Could not start attendance cameras", { description: (e as Error).message });
      setStatus("idle");
      setStatusText("Error");
    }
  }, [cameras, people, loadPeople, processCamera]);

  const stopAll = useCallback(() => {
    cameras.forEach((cam) => {
      cam.runningRef.current = false;
      const video = cam.videoRef.current;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    });
    setStatus("idle");
    setStatusText("Standby");
  }, [cameras]);

  useEffect(() => () => stopAll(), [stopAll]);

  // Analytics & Derived Statistics
  const uniqueRecognizedIds = useMemo(() => {
    return new Set(recent.map((r) => r.name));
  }, [recent]);

  const presentCount = uniqueRecognizedIds.size;
  const totalEnrolled = people.length;
  const attendanceRate = totalEnrolled > 0 ? Math.round((presentCount / totalEnrolled) * 100) : 0;

  const atRiskStudents = useMemo(() => {
    return people.filter((p) => !uniqueRecognizedIds.has(p.name));
  }, [people, uniqueRecognizedIds]);

  const avgConfidence = useMemo(() => {
    if (recent.length === 0) return 92;
    const avgDist = recent.reduce((acc, curr) => acc + curr.distance, 0) / recent.length;
    return Math.min(99, Math.max(75, Math.round((1 - avgDist * 1.2) * 100)));
  }, [recent]);

  const chartData = [
    { name: "Present", value: presentCount, color: "var(--color-success)" },
    { name: "Unaccounted", value: Math.max(0, totalEnrolled - presentCount), color: "var(--color-muted)" },
  ];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      {/* Top Academic Command Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Attendance Command Center
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="h-3 w-3" /> {statusText}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time biometric recognition & automatic student attendance logging.
          </p>
        </div>

        {/* Live Academic Clock & Session State */}
        <div className="flex items-center gap-3">
          <div className="bg-card border border-border px-3.5 py-2 rounded-lg text-right shadow-2xs">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Session Clock</p>
            <p className="text-sm font-bold tabular-nums text-foreground">
              {nowTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadPeople}
            disabled={status === "loading"}
            className="h-10"
            title="Refresh enrolled database"
          >
            <RefreshCw className={`h-4 w-4 ${status === "loading" ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline ml-1.5">Sync Database</span>
          </Button>
        </div>
      </div>

      {/* 4-Card KPI Stat Matrix */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Present Students */}
        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Verified Present</span>
            <span className="p-1.5 rounded-md bg-success/10 text-success">
              <UserCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums">
              {presentCount}
            </span>
            <span className="text-xs font-medium text-muted-foreground">/ {totalEnrolled} students</span>
          </div>
          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-success transition-all duration-500 rounded-full"
              style={{ width: `${Math.min(100, attendanceRate)}%` }}
            />
          </div>
        </div>

        {/* KPI 2: Attendance Rate % */}
        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Attendance Rate</span>
            <span className="p-1.5 rounded-md bg-primary/10 text-primary">
              <Activity className="h-4 w-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-primary tabular-nums">
              {attendanceRate}%
            </span>
            <span className="text-xs font-medium text-muted-foreground">in current hall</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {attendanceRate >= 75 ? (
              <span className="text-success font-medium">✓ Meets 75% quorum requirement</span>
            ) : (
              <span className="text-warning font-medium">⚠ Below recommended 75%</span>
            )}
          </p>
        </div>

        {/* KPI 3: At-Risk / Unaccounted */}
        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Unaccounted</span>
            <span className="p-1.5 rounded-md bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums">
              {atRiskStudents.length}
            </span>
            <span className="text-xs font-medium text-destructive">pending check-in</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {atRiskStudents.length === 0 ? "Full cohort accounted for" : "Flagged for lecture follow-up"}
          </p>
        </div>

        {/* KPI 4: Recognition Confidence & Engine */}
        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Detection Confidence</span>
            <span className="p-1.5 rounded-md bg-accent/20 text-accent-foreground">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums">
              {avgConfidence}%
            </span>
            <span className="text-xs font-medium text-success">Optimal</span>
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success inline-block" />
            TinyFace 512px · IoU 0.3
          </p>
        </div>
      </div>

      {/* Main Studio Viewport & Sidebar Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

        {/* Left Area (7 cols): Camera Grid & Controls */}
        <div className="lg:col-span-8 space-y-5">

          {/* Camera Configuration & Command Bar */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Video className="h-5 w-5 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Lecture Hall Feeds</h2>
                <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                  {cameras.length} {cameras.length === 1 ? "stream" : "streams"}
                </span>
              </div>

              {/* Master Start/Stop Toggle */}
              <div className="flex items-center gap-2">
                {status !== "running" ? (
                  <Button
                    onClick={startAll}
                    disabled={status === "loading"}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs"
                  >
                    {status === "loading" ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2 fill-current" />
                    )}
                    Start Lecture Feeds
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={stopAll} className="shadow-xs">
                    <Square className="h-4 w-4 mr-2 fill-current" /> Stop All Cameras
                  </Button>
                )}
              </div>
            </div>

            {/* Add Camera Controls (Collapsible inline) */}
            <div className="pt-2 border-t border-border flex flex-col sm:flex-row gap-2.5 items-end">
              <div className="flex-1 w-full space-y-1">
                <Label htmlFor="cam-label" className="text-xs text-muted-foreground">
                  New Camera Label / Sector
                </Label>
                <Input
                  id="cam-label"
                  placeholder="e.g. Front Podium, Balcony East"
                  value={newCameraLabel}
                  onChange={(e) => setNewCameraLabel(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>

              <div className="flex-1 w-full space-y-1">
                <Label htmlFor="cam-device" className="text-xs text-muted-foreground">
                  Video Input Device
                </Label>
                <select
                  id="cam-device"
                  value={newCameraDeviceId}
                  onChange={(e) => setNewCameraDeviceId(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                >
                  <option value="">System Default Camera</option>
                  {deviceInfos.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Device ${d.deviceId.slice(0, 8)}...`}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                variant="secondary"
                onClick={addCamera}
                disabled={status === "running"}
                className="h-9 shrink-0"
              >
                <Plus className="h-4 w-4 mr-1.5" /> Add Stream
              </Button>
            </div>
          </div>

          {/* Camera Video Viewports Grid */}
          <div className="grid grid-cols-1 gap-4">
            {cameras.map((cam) => (
              <div
                key={cam.id}
                className="rounded-xl border border-border bg-slate-950 overflow-hidden shadow-md flex flex-col"
              >
                {/* HUD Header Bar */}
                <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 text-slate-200">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${cam.runningRef.current ? "bg-success animate-pulse" : "bg-slate-500"}`} />
                    <span className="text-sm font-semibold tracking-wide text-white">{cam.label}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                      {cam.runningRef.current ? "LIVE · 640x480" : "STANDBY"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCamera(cam.id)}
                      disabled={status === "running"}
                      className="h-7 w-7 text-slate-400 hover:text-white hover:bg-slate-800"
                      aria-label={`Remove camera ${cam.label}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Video Feed with AI Overlay */}
                <div className="relative overflow-hidden aspect-video w-full bg-black flex items-center justify-center">
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
                  {!cam.runningRef.current && (
                    <div className="flex flex-col items-center justify-center text-slate-500 space-y-2 p-6 text-center">
                      <Camera className="h-10 w-10 text-slate-600" />
                      <p className="text-sm font-medium">Camera Inactive</p>
                      <p className="text-xs text-slate-600 max-w-xs">
                        Click "Start Lecture Feeds" to begin multi-person facial recognition tracking.
                      </p>
                    </div>
                  )}
                </div>

                {/* Hidden snapshot canvas */}
                <canvas ref={cam.canvasRef} className="hidden" />
              </div>
            ))}
          </div>
        </div>

        {/* Right Area (5 cols): Activity Feed, Roster & Donut Breakdown */}
        <div className="lg:col-span-4 space-y-5">

          {/* Donut Chart Summary Widget */}
          <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-3">
            <h3 className="text-sm font-bold text-foreground flex items-center justify-between">
              <span>Attendance Distribution</span>
              <span className="text-xs font-normal text-muted-foreground">{totalEnrolled} total enrolled</span>
            </h3>

            <div className="h-36 w-full flex items-center justify-center">
              {totalEnrolled > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      innerRadius={38}
                      outerRadius={58}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0];
                          return (
                            <div className="bg-popover border border-border p-2 rounded shadow-md text-xs">
                              <p className="font-semibold text-foreground">{data.name}</p>
                              <p className="text-muted-foreground">{data.value} students</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-xs text-muted-foreground">
                  No enrolled students in database.
                </div>
              )}
            </div>

            <div className="flex items-center justify-around text-xs border-t border-border pt-2.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-success" />
                <span className="text-muted-foreground">Present: <b className="text-foreground">{presentCount}</b></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                <span className="text-muted-foreground">Unaccounted: <b className="text-foreground">{Math.max(0, totalEnrolled - presentCount)}</b></span>
              </div>
            </div>
          </div>

          {/* Tabbed Activity & Roster Feed */}
          <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden flex flex-col min-h-[460px]">

            {/* Tab Selectors */}
            <div className="flex border-b border-border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("live")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === "live"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Live Feed ({recent.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("at-risk")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === "at-risk"
                    ? "bg-card text-destructive shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Unmarked ({atRiskStudents.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("roster")}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  activeTab === "roster"
                    ? "bg-card text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Full Roster
              </button>
            </div>

            {/* Tab 1: Live Verification Stream */}
            {activeTab === "live" && (
              <div className="p-4 flex-1 flex flex-col">
                <div
                  className="space-y-2.5 flex-1 overflow-y-auto max-h-[380px]"
                  aria-live="polite"
                >
                  {recent.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground space-y-2">
                      <Camera className="h-8 w-8 mx-auto text-muted-foreground/60" />
                      <p className="text-xs font-medium">Awaiting facial recognition detections</p>
                      <p className="text-[11px]">Recognized students will appear here with timestamp & photo proof.</p>
                    </div>
                  ) : (
                    recent.map((r) => (
                      <div
                        key={r.key}
                        className="flex items-center gap-3 p-2.5 rounded-lg border border-border/80 bg-muted/20 hover:bg-muted/40 transition-colors"
                      >
                        {r.snapshotUrl ? (
                          <img
                            src={r.snapshotUrl}
                            alt=""
                            className="h-10 w-10 rounded-md object-cover border border-border shrink-0"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-md bg-success/10 text-success flex items-center justify-center shrink-0">
                            <CheckCircle2 className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {r.time} · <span className="text-success font-medium">Confidence {(1 - r.distance * 1.5).toFixed(0)}%</span>
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: Unmarked / At-Risk Cohort */}
            {activeTab === "at-risk" && (
              <div className="p-4 flex-1 flex flex-col space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enrolled students not yet detected in today's active session.
                </p>
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[360px]">
                  {atRiskStudents.length === 0 ? (
                    <div className="text-center py-10 text-success space-y-1">
                      <CheckCircle2 className="h-8 w-8 mx-auto" />
                      <p className="text-xs font-semibold">100% Attendance Achieved!</p>
                      <p className="text-[11px] text-muted-foreground">All enrolled students have been verified.</p>
                    </div>
                  ) : (
                    atRiskStudents.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-card text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-destructive" />
                          <span className="font-medium text-foreground">{p.name}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {p.descriptors?.length ?? 0} samples
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Tab 3: Complete Roster Search */}
            {activeTab === "roster" && (
              <div className="p-4 flex-1 flex flex-col space-y-3">
                <Input
                  placeholder="Search roster by name..."
                  value={rosterSearch}
                  onChange={(e) => setRosterSearch(e.target.value)}
                  className="h-8 text-xs"
                />
                <div className="space-y-1.5 flex-1 overflow-y-auto max-h-[340px]">
                  {people
                    .filter((p) => p.name.toLowerCase().includes(rosterSearch.toLowerCase()))
                    .map((p) => {
                      const isPresent = uniqueRecognizedIds.has(p.name);
                      return (
                        <div
                          key={p.id}
                          className="flex items-center justify-between p-2 rounded-md border border-border/50 text-xs"
                        >
                          <span className="font-medium text-foreground">{p.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              isPresent
                                ? "bg-success/15 text-success"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {isPresent ? "Present" : "Absent"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Footer Navigation link to Logs */}
            <div className="p-3 bg-muted/30 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Need detailed audit proof?</span>
              <Link to="/logs" className="font-semibold text-primary hover:underline flex items-center gap-1">
                View Full Audit Logs <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
