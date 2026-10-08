import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { loadFaceApi } from "@/lib/face";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Camera,
  Loader2,
  Pencil,
  Play,
  Save,
  Square,
  Trash2,
  Upload,
  Users,
  X,
  Search,
  Download,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "Student Directory & Face Profiles — FaceMark" },
      {
        name: "description",
        content: "Manage enrolled students, append biometric training samples, and edit academic roll numbers.",
      },
      { property: "og:title", content: "Student Directory & Face Profiles — FaceMark" },
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
  const [editRoll, setEditRoll] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sampleFilter, setSampleFilter] = useState<"all" | "low" | "optimal">("all");

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
        toast.success("Additional sample vector recorded");
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

  const saveStudentDetails = async (id: string) => {
    const nextName = editName.trim();
    if (!nextName) return toast.error("Name cannot be empty.");
    setBusyId(id);
    const { error } = await supabase
      .from("people")
      .update({ name: nextName, roll_number: editRoll.trim() || null })
      .eq("id", id);
    setBusyId(null);
    if (error) return toast.error("Update failed", { description: error.message });
    toast.success("Student profile updated");
    setEditingId(null);
    refresh();
  };

  const remove = async (p: Person) => {
    if (!confirm(`Delete ${p.name} and all associated biometric samples? Historical logs are preserved.`)) return;
    setBusyId(p.id);
    const { error } = await supabase.from("people").delete().eq("id", p.id);
    setBusyId(null);
    if (error) return toast.error("Delete failed", { description: error.message });
    toast.success(`${p.name} removed from registry`);
    if (addingId === p.id) setAddingId(null);
    refresh();
  };

  // Filtered roster
  const filteredPeople = useMemo(() => {
    return people.filter((p) => {
      const matchQuery =
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.rollNumber.toLowerCase().includes(searchTerm.toLowerCase());
      const matchSample =
        sampleFilter === "all"
          ? true
          : sampleFilter === "low"
            ? p.sampleCount < 3
            : p.sampleCount >= 3;
      return matchQuery && matchSample;
    });
  }, [people, searchTerm, sampleFilter]);

  const exportRosterCSV = () => {
    if (people.length === 0) return toast.error("No students enrolled");
    const headers = ["Student ID", "Full Name", "Roll / Registration Number", "Sample Vectors", "Enrolled Date"];
    const rows = people.map((p) => [p.id, p.name, p.rollNumber || "N/A", p.sampleCount, new Date(p.created_at).toLocaleDateString()]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map((e) => e.map((val) => `"${val}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FaceMark_Student_Roster_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Student directory exported to CSV");
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Student Directory & Profiles
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
              <Users className="h-3 w-3" /> {people.length} Enrolled
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Maintain enrolled student profiles, augment face samples for high accuracy, and manage registration records.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportRosterCSV} className="h-9">
            <Download className="h-4 w-4 mr-1.5" /> Export Roster CSV
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} className="h-9">
            <Users className="h-4 w-4 mr-1.5" /> Reload
          </Button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by student name or roll number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Quality Filter Tabs */}
        <div className="flex border border-border rounded-lg bg-muted/30 p-0.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setSampleFilter("all")}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              sampleFilter === "all" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground"
            }`}
          >
            All Students ({people.length})
          </button>
          <button
            type="button"
            onClick={() => setSampleFilter("optimal")}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              sampleFilter === "optimal" ? "bg-card text-success shadow-2xs" : "text-muted-foreground"
            }`}
          >
            Optimal Samples ({people.filter((p) => p.sampleCount >= 3).length})
          </button>
          <button
            type="button"
            onClick={() => setSampleFilter("low")}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              sampleFilter === "low" ? "bg-card text-warning shadow-2xs" : "text-muted-foreground"
            }`}
          >
            Low Samples ({people.filter((p) => p.sampleCount < 3).length})
          </button>
        </div>
      </div>

      {/* Roster Table / List */}
      <section className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading enrolled student directory...
          </div>
        ) : filteredPeople.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground space-y-2">
            <Users className="h-8 w-8 mx-auto text-muted-foreground/60" />
            <p className="text-sm font-medium">No matching student profiles found.</p>
            <p className="text-xs">Try adjusting your search criteria or enroll new students.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {filteredPeople.map((p) => (
              <li key={p.id} className="p-4 space-y-3 hover:bg-muted/20 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

                  {/* Inline Edit View */}
                  {editingId === p.id ? (
                    <div className="flex flex-col sm:flex-row items-center gap-2 flex-1">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Student Name"
                        className="h-9 text-sm"
                        autoFocus
                      />
                      <Input
                        value={editRoll}
                        onChange={(e) => setEditRoll(e.target.value)}
                        placeholder="Roll Number"
                        className="h-9 text-sm"
                      />
                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <Button
                          size="sm"
                          onClick={() => saveStudentDetails(p.id)}
                          disabled={busyId === p.id}
                          className="h-9"
                        >
                          <Save className="h-4 w-4 mr-1" /> Save
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          className="h-9 w-9"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Standard Profile View */}
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-base text-foreground truncate">{p.name}</p>
                          {p.rollNumber && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-primary/10 text-primary border border-primary/20 font-semibold">
                              {p.rollNumber}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            {p.sampleCount >= 3 ? (
                              <span className="inline-flex items-center gap-1 text-success font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" /> {p.sampleCount} vectors (High Accuracy)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-warning font-medium">
                                <AlertTriangle className="h-3.5 w-3.5" /> {p.sampleCount} vector{p.sampleCount === 1 ? "" : "s"} (Add more angles)
                              </span>
                            )}
                          </span>
                          <span>· Enrolled {new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(p.id);
                            setEditName(p.name);
                            setEditRoll(p.rollNumber);
                          }}
                          className="h-8.5 text-xs"
                        >
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Details
                        </Button>

                        <Button
                          size="sm"
                          variant={addingId === p.id ? "secondary" : "default"}
                          onClick={() => setAddingId(addingId === p.id ? null : p.id)}
                          className="h-8.5 text-xs shadow-2xs"
                        >
                          <Camera className="h-3.5 w-3.5 mr-1" />
                          {addingId === p.id ? "Close Camera" : "Append Vectors"}
                        </Button>

                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => remove(p)}
                          disabled={busyId === p.id}
                          className="h-8.5 w-8.5 text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${p.name}`}
                        >
                          {busyId === p.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </div>

                {/* Collapsible Sample Augmentation HUD */}
                {addingId === p.id && (
                  <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-primary" /> Multi-Angle Biometric Augmentation for {p.name}
                      </span>
                      <span>Capture distinct lighting and head angles</span>
                    </div>

                    <div className="relative overflow-hidden rounded-lg border border-border bg-slate-950 aspect-video max-w-md">
                      <video ref={videoRef} className="absolute inset-0 h-full w-full object-contain" playsInline muted />
                      {!camOn && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                          <Camera className="h-8 w-8 mb-1 text-slate-600" />
                          <p className="text-xs font-medium">Camera Inactive</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!camOn ? (
                        <Button size="sm" onClick={startCam} className="h-8 text-xs">
                          <Play className="h-3.5 w-3.5 mr-1.5 fill-current" /> Start Camera
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={stopCam} className="h-8 text-xs">
                          <Square className="h-3.5 w-3.5 mr-1.5 fill-current" /> Stop Camera
                        </Button>
                      )}

                      <Button
                        size="sm"
                        onClick={() => captureSample(p.id)}
                        disabled={!camOn || busyId === p.id}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs shadow-xs"
                      >
                        {busyId === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <Camera className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Capture Angle
                      </Button>

                      <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                        <label className="cursor-pointer">
                          <Upload className="h-3.5 w-3.5 mr-1.5" /> Upload Photos
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
  );
}
