import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadFaceApi } from "@/lib/face";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Camera, Loader2, UserPlus, Trash2, Play, Square, Upload } from "lucide-react";

export const Route = createFileRoute("/enroll")({
  head: () => ({
    meta: [
      { title: "Enroll People — FaceMark" },
      { name: "description", content: "Add people to the face-recognition database by capturing sample images." },
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
      .order("created_at", { ascending: false });
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
        toast.error("No face detected. Face the camera and try again.");
        return;
      }
      // preview
      const c = document.createElement("canvas");
      c.width = 120;
      c.height = 120;
      const { x, y, width, height } = detection.detection.box;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(v, x, y, width, height, 0, 0, 120, 120);
      setPreviews((p) => [...p, c.toDataURL("image/jpeg", 0.7)]);
      setCaptures((c) => [...c, detection.descriptor]);
      toast.success("Sample captured");
    } catch (e) {
      toast.error("Capture failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
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
          // Use same detector options as live camera for consistency
          const detections = await faceapi
            .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 }))
            .withFaceLandmarks()
            .withFaceDescriptors();
          if (detections.length === 0) {
            fail++;
            URL.revokeObjectURL(url);
            continue;
          }
          // Use the detection with the highest score (first in array after descending sort by score)
          const best = detections.reduce((prev: any, current: any) => (prev.detection.score > current.detection.score ? prev : current));
          const c = document.createElement("canvas");
          c.width = 120;
          c.height = 120;
          const { x, y, width, height } = best.detection.box;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, x, y, width, height, 0, 0, 120, 120);
          setPreviews((p) => [...p, c.toDataURL("image/jpeg", 0.7)]);
          setCaptures((cs) => [...cs, best.descriptor]);
          URL.revokeObjectURL(url);
          ok++;
        } catch {
          fail++;
        }
      }
      if (ok > 0) toast.success(`Added ${ok} photo${ok === 1 ? "" : "s"}${fail ? ` (${fail} skipped)` : ""}`);
      else toast.error("No faces detected in the selected photo(s).");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Enter a name.");
    if (captures.length === 0) return toast.error("Capture at least one sample.");
    setBusy(true);
    const descriptors = captures.map((d) => Array.from(d));
    const { error } = await supabase.from("people").insert({
      name: name.trim(),
      descriptors,
      roll_number: rollNumber.trim() || null
    });
    setBusy(false);
    if (error) return toast.error("Save failed", { description: error.message });
    const rollDisplay = rollNumber.trim() ? ` (Roll: ${rollNumber})` : '';
    toast.success(`Enrolled ${name}${rollDisplay}`);
    setName("");
    setRollNumber("");
    setCaptures([]);
    setPreviews([]);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this person?")) return;
    const { error } = await supabase.from("people").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight">Enroll people</h1>
        <p className="text-muted-foreground mt-1">
          Capture samples from the webcam or upload a passport-style photo. Multiple samples improve accuracy.
        </p>

        <div className="grid gap-6 mt-8 lg:grid-cols-2">
          <section className="space-y-4">
            <div className="relative overflow-hidden rounded-xl border border-border bg-black aspect-video">
              <video ref={videoRef} className="absolute inset-0 h-full w-full object-contain" playsInline muted />
              {!camOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                  <Camera className="h-10 w-10 mb-2" />
                  <p>Camera off</p>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {!camOn ? (
                <Button onClick={startCam}><Play className="h-4 w-4 mr-2" /> Start camera</Button>
              ) : (
                <Button variant="secondary" onClick={stopCam}><Square className="h-4 w-4 mr-2" /> Stop</Button>
              )}
              <Button onClick={capture} disabled={!camOn || busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}
                Capture sample
              </Button>
              <Button asChild variant="outline" disabled={busy}>
                <label className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload photo
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

            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="" />
            </div>

            <div>
              <Label htmlFor="rollNumber">Roll Number</Label>
              <Input id="rollNumber" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} placeholder="" />
            </div>

            {previews.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">{previews.length} sample(s)</p>
                <div className="flex flex-wrap gap-2">
                  {previews.map((src, i) => (
                    <img key={i} src={src} alt="" className="h-16 w-16 rounded-md object-cover border border-border" />
                  ))}
                </div>
              </div>
            )}

            <Button onClick={save} disabled={busy || captures.length === 0 || !name.trim()} className="w-full">
              <UserPlus className="h-4 w-4 mr-2" /> Save person
            </Button>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Enrolled ({people.length})
            </h2>
            {people.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one enrolled yet.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {people.map((p) => (
                  <li key={p.id} className="flex items-center justify-between p-3">
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.sampleCount} sample{p.sampleCount === 1 ? "" : "s"} · {new Date(p.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => remove(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
