import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CalendarClock, Trash2, RefreshCw, CheckCircle2, XCircle, Loader2, Square, Play } from "lucide-react";

export const Route = createFileRoute("/classes")({
  head: () => ({
    meta: [
      { title: "Class Sessions — FaceMark" },
      {
        name: "description",
        content: "Schedule a class time and see which enrolled students were present during it.",
      },
      { property: "og:title", content: "Class Sessions — FaceMark" },
      {
        property: "og:description",
        content: "Schedule a class time and see which enrolled students were present during it.",
      },
    ],
  }),
  component: ClassesPage,
});

type Session = {
  id: string;
  class_name: string;
  professor_name: string | null;
  camera_label: string | null;
  starts_at: string;
  ends_at: string;
};

type Present = { person_name: string; camera_label: string; created_at: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Please try again.";
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ClassesPage() {
  const now = useMemo(() => new Date(), []);
  const [className, setClassName] = useState("");
  const [professor, setProfessor] = useState("");
  const [camera, setCamera] = useState("");
  const [startsAt, setStartsAt] = useState(toLocalInput(now));
  const [endsAt, setEndsAt] = useState(toLocalInput(new Date(now.getTime() + 60 * 60 * 1000)));
  const [saving, setSaving] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [present, setPresent] = useState<Present[]>([]);
  const [enrolled, setEnrolled] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingSessionId, setStartingSessionId] = useState<string | null>(null);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from("class_sessions")
      .select("id, class_name, professor_name, camera_label, starts_at, ends_at")
      .order("starts_at", { ascending: false })
      .limit(100);
    if (error) toast.error("Could not load class sessions");
    setSessions((data ?? []) as Session[]);
  }, []);

  useEffect(() => {
    loadSessions();
    supabase
      .from("people")
      .select("name")
      .then(({ data }) => setEnrolled(((data ?? []) as { name: string }[]).map((p) => p.name)));
  }, [loadSessions]);

  const createSession = async () => {
    if (!className.trim()) return toast.error("Enter a class name");
    if (new Date(endsAt) <= new Date(startsAt)) return toast.error("End time must be after start time");
    setSaving(true);
    const { error } = await supabase.from("class_sessions").insert({
      class_name: className.trim(),
      professor_name: professor.trim() || null,
      camera_label: camera.trim() || null,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
    });
    setSaving(false);
    if (error) return toast.error("Could not save class session");
    toast.success("Class session created");
    setClassName("");
    loadSessions();
  };

  const removeSession = async (id: string) => {
    const { error } = await supabase.from("class_sessions").delete().eq("id", id);
    if (error) return toast.error("Could not delete session");
    if (selected?.id === id) setSelected(null);
    loadSessions();
  };

  const startSession = async (s: Session) => {
    setStartingSessionId(s.id);
    try {
      const now = new Date();
      // Set starts_at to 5 minutes ago to allow for late starts
      const startsAt = new Date(now.getTime() - 5 * 60 * 1000);
      // Set ends_at to 2 hours from now (adjustable)
      const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const { error } = await supabase
        .from("class_sessions")
        .update({
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        })
        .eq("id", s.id);

      if (error) throw error;

      toast.success("Class started");
      loadSessions();
    } catch (error) {
      toast.error("Could not start class", { description: errorMessage(error) });
    } finally {
      setStartingSessionId(null);
    }
  };

  const stopSession = async (s: Session) => {
    setStoppingSessionId(s.id);
    try {
      const now = new Date();

      const { error } = await supabase
        .from("class_sessions")
        .update({
          ends_at: now.toISOString(),
        })
        .eq("id", s.id);

      if (error) throw error;

      toast.success("Class stopped");
      loadSessions();
    } catch (error) {
      toast.error("Could not stop class", { description: errorMessage(error) });
    } finally {
      setStoppingSessionId(null);
    }
  };

  const openSession = async (s: Session) => {
    setSelected(s);
    setLoading(true);
    let q = supabase
      .from("attendance")
      .select("person_name, camera_label, created_at")
      .gte("created_at", s.starts_at)
      .lte("created_at", s.ends_at)
      .order("created_at", { ascending: true });
    if (s.camera_label) q = q.eq("camera_label", s.camera_label);
    const { data, error } = await q;
    setLoading(false);
    if (error) return toast.error("Could not load attendance");
    // first sighting per person
    const seen = new Map<string, Present>();
    for (const r of (data ?? []) as Present[]) if (!seen.has(r.person_name)) seen.set(r.person_name, r);
    setPresent([...seen.values()]);
  };

  const absent = enrolled.filter((n) => !present.some((p) => p.person_name === n));

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight">Class sessions</h1>
        <p className="text-muted-foreground mt-1">
          Set a class time, then see which enrolled students were recognised during it.
        </p>

        <div className="grid gap-6 md:grid-cols-2 mt-6">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold flex items-center gap-2">
              <CalendarClock className="h-4 w-4" /> New class session
            </h2>
            <div className="grid gap-3 mt-4">
              <div className="grid gap-1.5">
                <Label htmlFor="class-name">Class name</Label>
                <Input id="class-name" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="Physics 101" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="professor">Professor</Label>
                <Input id="professor" value={professor} onChange={(e) => setProfessor(e.target.value)} placeholder="Dr. Rao" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="camera">Camera / room (optional)</Label>
                <Input id="camera" value={camera} onChange={(e) => setCamera(e.target.value)} placeholder="Main Entrance" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="start">Starts</Label>
                  <Input id="start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="end">Ends</Label>
                  <Input id="end" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </div>
              </div>
              <Button onClick={createSession} disabled={saving}>
                {saving ? "Saving…" : "Create session"}
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Scheduled classes</h2>
              <Button variant="ghost" size="sm" onClick={loadSessions}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {sessions.length === 0 && (
                <li className="py-6 text-center text-sm text-muted-foreground">No class sessions yet.</li>
              )}
              {sessions.map((s) => {
                const now = new Date();
                const startsAt = new Date(s.starts_at);
                const endsAt = new Date(s.ends_at);
                const isRunning = now >= startsAt && now <= endsAt;
                const isUpcoming = now < startsAt;
                return (
                  <li key={s.id} className="py-3 flex items-center justify-between gap-3">
                    <button className="text-left flex-1" onClick={() => openSession(s)}>
                      <p className="font-medium">{s.class_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.starts_at).toLocaleString()} — {new Date(s.ends_at).toLocaleTimeString()}
                        {s.professor_name ? ` · ${s.professor_name}` : ""}
                        {s.camera_label ? ` · ${s.camera_label}` : ""}
                      </p>
                    </button>
                    <div className="flex space-x-2">
                      {!isRunning && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Start session"
                          disabled={startingSessionId === s.id || stoppingSessionId === s.id || !isUpcoming}
                          onClick={() => startSession(s)}
                        >
                          {startingSessionId === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {isRunning && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Stop session"
                          disabled={startingSessionId === s.id || stoppingSessionId === s.id}
                          onClick={() => stopSession(s)}
                        >
                          {stoppingSessionId === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" aria-label="Delete session" onClick={() => removeSession(s.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {selected && (
          <section className="mt-8 rounded-lg border border-border bg-card p-5">
            <h2 className="font-semibold">
              Attendance — {selected.class_name}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {new Date(selected.starts_at).toLocaleString()} → {new Date(selected.ends_at).toLocaleString()}
              </span>
            </h2>
            {loading ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 mt-4">
                <div>
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-chart-2" /> Present ({present.length})
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {present.length === 0 && <li className="text-muted-foreground">Nobody recognised in this window.</li>}
                    {present.map((p) => (
                      <li key={p.person_name} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
                        <span className="font-medium">{p.person_name}</span>
                        <span className="text-muted-foreground text-xs">
                          {new Date(p.created_at).toLocaleTimeString()} · {p.camera_label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-destructive" /> Absent ({absent.length})
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {absent.length === 0 && <li className="text-muted-foreground">Everyone enrolled was present.</li>}
                    {absent.map((n) => (
                      <li key={n} className="rounded-md bg-muted/50 px-3 py-2">{n}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
