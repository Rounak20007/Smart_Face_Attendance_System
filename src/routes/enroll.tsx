import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadFaceApi } from "@/lib/face";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Camera,
  Loader2,
  UserPlus,
  Trash2,
  Play,
  Square,
  Upload,
  Users,
  Sparkles,
  X,
} from "lucide-react";

export const Route = createFileRoute("/enroll")({
  head: () => ({
    meta: [
      { title: "Student Biometric Enrollment — FaceMark" },
      { name: "description", content: "Enroll students into the biometric recognition database with multi-angle facial sample captures." },
    ],
  }),
  component: EnrollPage,
});

type Person = { id: string; name: string; rollNumber: string; created_at: string; sampleCount: number };

function EnrollPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [name, setName] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [captures, setCaptures] = useState<Float32Array[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Person[]>([]);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("people")
      .select("id, name, roll_number, created_at, descriptors")
      .order("created_at", { ascending: false })
      .limit(10);
    setPeople(
      (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        rollNumber: p.roll_number ?? "",
        created_at: p.created_at,
        sampleCount: Array.isArray(p.descriptors) ? (p.descriptors as unknown[]).length : 0,
      })),
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const startCam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCamOn(true);
    } catch (e) {
      toast.error("Camera error", { description: (e as Error).message });
    }
  };

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
  }, []);

  useEffect(() => () => stopCam(), [stopCam]);

  const capture = async () => {
    if (!camOn || !videoRef.current) return;
    setBusy(true);
    try {
      const faceapi = await loadFaceApi();
      const v = videoRef.current;
      const detection = await faceapi
        .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        toast.error("No face detected. Please center your face in the camera frame.");
        return;
      }

      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      const { x, y, width, height } = detection.detection.box;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(v, x, y, width, height, 0, 0, 120, 120);

      setPreviews((p) => [...p, c.toDataURL("image/jpeg", 0.75)]);
      setCaptures((c) => [...c, detection.descriptor]);
      toast.success(`Captured angle ${captures.length + 1}`);
    } catch (e) {
      toast.error("Capture failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const removeSample = (index: number) => {
    setPreviews((p) => p.filter((_, i) => i !== index));
    setCaptures((c) => c.filter((_, i) => i !== index));
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const faceapi = await loadFaceApi();
      let ok = 0;
      let fail = 0;
      for (const file of Array.from(files)) {
        try {
          const url = URL.createObjectURL(file);
          const img = await faceapi.fetchImage(url);
          const detections = await faceapi
            .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 }))
            .withFaceLandmarks()
            .withFaceDescriptors();

          if (detections.length === 0) {
            fail++;
            URL.revokeObjectURL(url);
            continue;
          }

          const best = detections.reduce((prev: any, current: any) =>
            prev.detection.score > current.detection.score ? prev : current,
          );
          const c = document.createElement("canvas");
          c.width = 120;
          c.height = 120;
          const { x, y, width, height } = best.detection.box;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, x, y, width, height, 0, 0, 120, 120);

          setPreviews((p) => [...p, c.toDataURL("image/jpeg", 0.75)]);
          setCaptures((cs) => [...cs, best.descriptor]);
          URL.revokeObjectURL(url);
          ok++;
        } catch {
          fail++;
        }
      }
      if (ok > 0) {
        toast.success(`Extracted facial descriptors from ${ok} photo${ok === 1 ? "" : "s"}${fail > 0 ? ` (${fail} failed/skipped)` : ""}`);
      } else {
        toast.error("No faces detected in the uploaded images.");
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Please enter the student's full name.");
    if (captures.length === 0) return toast.error("Please capture at least one facial sample.");
    setBusy(true);
    const descriptors = captures.map((d) => Array.from(d));
    const { error } = await supabase.from("people").insert({
      name: name.trim(),
      descriptors,
      roll_number: rollNumber.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error("Enrollment failed", { description: error.message });

    const rollDisplay = rollNumber.trim() ? ` [${rollNumber}]` : "";
    toast.success(`Successfully enrolled ${name}${rollDisplay}`);
    setName("");
    setRollNumber("");
    setCaptures([]);
    setPreviews([]);
    refresh();
  };

  const remove = async (id: string, personName: string) => {
    if (!confirm(`Delete enrollment for ${personName}?`)) return;
    const { error } = await supabase.from("people").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Removed ${personName}`);
    refresh();
  };

  // Quality calculation
  const sampleQuality =
    captures.length === 0
      ? { label: "No Samples", color: "text-muted-foreground", bg: "bg-muted" }
      : captures.length < 3
        ? { label: "Fair (1-2 Angles)", color: "text-warning", bg: "bg-warning/15" }
        : { label: "High Biometric Accuracy (3+ Angles)", color: "text-success", bg: "bg-success/15" };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Student Biometric Enrollment
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="h-3 w-3" /> 128D Vector Extraction
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Register students into the institutional recognition database with multi-angle facial captures.
          </p>
        </div>
      </div>

      {/* Grid: Multi-Step Enrollment (8 cols) & Recent Enrolled List (4 cols) */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">

        {/* Left Form & Capture Center (8 cols) */}
        <section className="lg:col-span-8 rounded-xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-6">

          {/* Step 1: Student Identity */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-border/60 pb-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                1
              </span>
              <h2 className="text-base font-semibold text-foreground">Student Identity Details</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-medium text-foreground">
                  Full Student Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Johnathan Doe"
                  className="h-9.5 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rollNumber" className="text-xs font-medium text-foreground">
                  Roll / Registration Number
                </Label>
                <Input
                  id="rollNumber"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  placeholder="e.g. 2024-CS-042"
                  className="h-9.5 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Step 2: Biometric Facial Capture */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  2
                </span>
                <h2 className="text-base font-semibold text-foreground">Facial Biometric Samples</h2>
              </div>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${sampleQuality.bg} ${sampleQuality.color}`}>
                {sampleQuality.label}
              </span>
            </div>

            {/* Video Viewport HUD */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-slate-950 aspect-video max-h-[360px] flex items-center justify-center shadow-inner">
              <video ref={videoRef} className="h-full w-full object-contain" playsInline muted />

              {/* Guide Overlay when camera is active */}
              {camOn && (
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center border-2 border-dashed border-primary/40 rounded-xl m-8">
                  <span className="text-[11px] font-medium text-white/80 bg-black/60 px-2 py-0.5 rounded mt-auto mb-3">
                    Align face within guide frame
                  </span>
                </div>
              )}

              {!camOn && (
                <div className="flex flex-col items-center justify-center text-slate-500 space-y-2 p-6 text-center">
                  <Camera className="h-10 w-10 text-slate-600" />
                  <p className="text-sm font-medium">Camera Standby</p>
                  <p className="text-xs text-slate-600 max-w-xs">
                    Start webcam or upload passport photos to extract 128-dimensional facial vectors.
                  </p>
                </div>
              )}
            </div>

            {/* Capture Buttons Toolbar */}
            <div className="flex flex-wrap gap-2.5">
              {!camOn ? (
                <Button onClick={startCam} className="h-9">
                  <Play className="h-4 w-4 mr-1.5 fill-current" /> Start Webcam
                </Button>
              ) : (
                <Button variant="secondary" onClick={stopCam} className="h-9">
                  <Square className="h-4 w-4 mr-1.5 fill-current" /> Stop Webcam
                </Button>
              )}

              <Button
                onClick={capture}
                disabled={!camOn || busy}
                className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 shadow-xs"
              >
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}
                Capture Angle ({captures.length})
              </Button>

              <Button asChild variant="outline" disabled={busy} className="h-9">
                <label className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Photo(s)
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      uploadPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </Button>
            </div>

            {/* Multi-angle Gallery Preview */}
            {previews.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Captured Samples ({previews.length})</span>
                  <span>Recommended: Frontal, Left tilt, Right tilt</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {previews.map((src, i) => (
                    <div key={i} className="relative group rounded-md overflow-hidden border border-border bg-black">
                      <img src={src} alt="" className="h-16 w-16 object-cover" />
                      <button
                        type="button"
                        onClick={() => removeSample(i)}
                        className="absolute top-1 right-1 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete this sample"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Step 3: Submission & Database Commit */}
          <div className="pt-2 border-t border-border">
            <Button
              onClick={save}
              disabled={busy || captures.length === 0 || !name.trim()}
              className="w-full bg-success hover:bg-success/90 text-success-foreground font-semibold h-11 text-base shadow-sm"
            >
              {busy ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Enrolling Student...
                </>
              ) : (
                <>
                  <UserPlus className="h-5 w-5 mr-2" /> Complete & Save Enrollment
                </>
              )}
            </Button>
          </div>
        </section>

        {/* Right Sidebar: Recent Enrollments (4 cols) */}
        <section className="lg:col-span-4 rounded-xl border border-border bg-card p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-md bg-accent/20 text-accent-foreground">
                <Users className="h-4 w-4" />
              </span>
              <h2 className="font-semibold text-base text-foreground">Recently Enrolled</h2>
            </div>
            <span className="text-xs text-muted-foreground font-mono">{people.length} latest</span>
          </div>

          <div className="divide-y divide-border/60 overflow-y-auto max-h-[520px]">
            {people.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground space-y-2">
                <Users className="h-8 w-8 mx-auto text-muted-foreground/60" />
                <p className="text-sm font-medium">No students enrolled yet</p>
                <p className="text-xs">Newly registered profiles will appear here.</p>
              </div>
            ) : (
              people.map((p) => (
                <div key={p.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{p.name}</p>
                    {p.rollNumber && (
                      <p className="text-xs text-primary font-mono">Roll: {p.rollNumber}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {p.sampleCount} vectors · {new Date(p.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => remove(p.id, p.name)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
