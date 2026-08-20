import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadFaceApi } from "@/lib/face";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Camera, Loader2, Pencil, Play, Save, Square, Trash2, Upload, Users, X } from "lucide-react";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "Manage People — FaceMark" },
      {
        name: "description",
        content: "Edit names, add more face samples, or remove people from the FaceMark recognition database.",
      },
      { property: "og:title", content: "Manage People — FaceMark" },
      {
        property: "og:description",
        content: "Edit names, add more face samples, or remove people from the FaceMark recognition database.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PeoplePage,
});

type Person = { id: string; name: string; rollNumber: string; created_at: string; sampleCount: number };

function PeoplePage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("people")
      .select("id, name, roll_number, created_at, descriptors")
      .order("name", { ascending: true });
    if (error) toast.error("Could not load people", { description: error.message });
    setPeople(
      (data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        rollNumber: p.roll_number ?? "",
        created_at: p.created_at,
        sampleCount: Array.isArray(p.descriptors) ? (p.descriptors as unknown[]).length : 0,
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
  }, []);

  useEffect(() => () => stopCam(), [stopCam]);

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

  const appendDescriptors = async (id: string, newOnes: number[][]) => {
    const { data, error } = await supabase.from("people").select("descriptors").eq("id", id).single();
    if (error || !data) {
      toast.error("Could not load existing samples", { description: error?.message });
      return false;
    }
    const existing = Array.isArray(data.descriptors) ? (data.descriptors as unknown as number[][]) : [];
    const { error: upErr } = await supabase
      .from("people")
      .update({ descriptors: [...existing, ...newOnes] })
      .eq("id", id);
    if (upErr) {
      toast.error("Could not save samples", { description: upErr.message });
      return false;
    }
    return true;
  };

  const captureSample = async (id: string) => {
    if (!camOn || !videoRef.current) return toast.error("Start the camera first.");
    setBusyId(id);
    try {
      const faceapi = await loadFaceApi();
      const detection = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) return toast.error("No face detected. Face the camera and try again.");
      if (await appendDescriptors(id, [Array.from(detection.descriptor)])) {
        toast.success("Sample added");
        refresh();
      }
    } catch (e) {
      toast.error("Capture failed", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const uploadSamples = async (id: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusyId(id);
    try {
      const faceapi = await loadFaceApi();
      const found: number[][] = [];
      let fail = 0;
      for (const file of Array.from(files)) {
        const url = URL.createObjectURL(file);
        try {
          const img = await faceapi.fetchImage(url);
          const detection = await faceapi
            .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 }))
            .withFaceLandmarks()
            .withFaceDescriptor();
          if (detection) found.push(Array.from(detection.descriptor));
          else fail++;
        } catch {
          fail++;
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (found.length === 0) return toast.error("No faces detected in the selected photo(s).");
      if (await appendDescriptors(id, found)) {
        toast.success(`Added ${found.length} sample${found.length === 1 ? "" : "s"}${fail ? ` (${fail} skipped)` : ""}`);
        refresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const saveName = async (id: string) => {
    const next = editName.trim();
    if (!next) return toast.error("Name cannot be empty.");
    setBusyId(id);
    const { error } = await supabase.from("people").update({ name: next }).eq("id", id);
    setBusyId(null);
    if (error) return toast.error("Rename failed", { description: error.message });
    toast.success("Name updated");
    setEditingId(null);
    refresh();
  };

  const remove = async (p: Person) => {
    if (!confirm(`Delete ${p.name} and all their face samples? Attendance logs are kept.`)) return;
    setBusyId(p.id);
    const { error } = await supabase.from("people").delete().eq("id", p.id);
    setBusyId(null);
    if (error) return toast.error("Delete failed", { description: error.message });
    toast.success(`${p.name} deleted`);
    if (addingId === p.id) setAddingId(null);
    refresh();
  };

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight">Manage people</h1>
        <p className="text-muted-foreground mt-1">
          Rename someone, add extra face samples to improve recognition, or remove them from the database.
        </p>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <Users className="h-4 w-4" /> Enrolled ({people.length})
          </h2>

          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one enrolled yet. Use the Enroll page to add people.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {people.map((p) => (
                <li key={p.id} className="p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    {editingId === p.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveName(p.id)}
                          autoFocus
                        />
                        <Button size="icon" onClick={() => saveName(p.id)} disabled={busyId === p.id}>
                          <Save className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{p.name}</p>
                          {p.rollNumber && (
                            <p className="text-xs text-muted-foreground">
                              Roll: {p.rollNumber}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {p.sampleCount} sample{p.sampleCount === 1 ? "" : "s"} · added{" "}
                            {new Date(p.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(p.id);
                              setEditName(p.name);
                            }}
                          >
                            <Pencil className="h-4 w-4 mr-1" /> Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAddingId(addingId === p.id ? null : p.id)}
                          >
                            <Camera className="h-4 w-4 mr-1" /> Samples
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => remove(p)} disabled={busyId === p.id}>
                            {busyId === p.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  {addingId === p.id && (
                    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                      <div className="relative overflow-hidden rounded-md border border-border bg-black aspect-video max-w-md">
                        <video
                          ref={videoRef}
                          className="absolute inset-0 h-full w-full object-contain"
                          playsInline
                          muted
                        />
                        {!camOn && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                            <Camera className="h-8 w-8 mb-1" />
                            <p className="text-sm">Camera off</p>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!camOn ? (
                          <Button size="sm" onClick={startCam}>
                            <Play className="h-4 w-4 mr-2" /> Start camera
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={stopCam}>
                            <Square className="h-4 w-4 mr-2" /> Stop
                          </Button>
                        )}
                        <Button size="sm" onClick={() => captureSample(p.id)} disabled={!camOn || busyId === p.id}>
                          {busyId === p.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Camera className="h-4 w-4 mr-2" />
                          )}
                          Capture sample
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <label className="cursor-pointer">
                            <Upload className="h-4 w-4 mr-2" /> Upload photos
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                uploadSamples(p.id, e.target.files);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
