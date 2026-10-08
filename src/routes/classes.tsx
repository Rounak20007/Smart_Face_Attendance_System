import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CalendarClock,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Square,
  Play,
  Clock,
  Users,
  Building2,
  Search,
  Download,
  BookOpen,
} from "lucide-react";

export const Route = createFileRoute("/classes")({
  head: () => ({
    meta: [
      { title: "Class Sessions & Timetable — FaceMark" },
      {
        name: "description",
        content: "Schedule lecture times and audit verified student attendance with quorum tracking.",
      },
      { property: "og:title", content: "Class Sessions & Timetable — FaceMark" },
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
  const [searchFilter, setSearchFilter] = useState("");
  const [attendanceTab, setAttendanceTab] = useState<"all" | "present" | "absent">("all");

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
    toast.success("Class session scheduled successfully");
    setClassName("");
    setProfessor("");
    setCamera("");
    loadSessions();
  };

  const removeSession = async (id: string) => {
    if (!confirm("Are you sure you want to delete this lecture session?")) return;
    const { error } = await supabase.from("class_sessions").delete().eq("id", id);
    if (error) return toast.error("Could not delete session");
    if (selected?.id === id) setSelected(null);
    toast.success("Session removed");
    loadSessions();
  };

  const startSession = async (s: Session) => {
    setStartingSessionId(s.id);
    try {
      const now = new Date();
      const startsAt = new Date(now.getTime() - 5 * 60 * 1000);
      const endsAt = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const { error } = await supabase
        .from("class_sessions")
        .update({
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        })
        .eq("id", s.id);

      if (error) throw error;

      toast.success(`Lecture started: ${s.class_name}`);
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

      toast.success(`Lecture ended: ${s.class_name}`);
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
    const seen = new Map<string, Present>();
    for (const r of (data ?? []) as Present[]) if (!seen.has(r.person_name)) seen.set(r.person_name, r);
    setPresent([...seen.values()]);
  };

  const absent = useMemo(() => {
    return enrolled.filter((n) => !present.some((p) => p.person_name === n));
  }, [enrolled, present]);

  const quorumRate = enrolled.length > 0 ? Math.round((present.length / enrolled.length) * 100) : 0;

  const exportClassAttendanceCSV = () => {
    if (!selected) return;
    const rows = [
      ["Class Name", selected.class_name],
      ["Professor", selected.professor_name || "N/A"],
      ["Camera / Sector", selected.camera_label || "All Feeds"],
      ["Start Time", new Date(selected.starts_at).toLocaleString()],
      ["End Time", new Date(selected.ends_at).toLocaleString()],
      ["Attendance Quorum", `${quorumRate}% (${present.length}/${enrolled.length})`],
      [],
      ["Student Name", "Status", "Verified Time", "Detection Sector"],
      ...present.map((p) => [p.person_name, "Present", new Date(p.created_at).toLocaleTimeString(), p.camera_label]),
      ...absent.map((a) => [a, "Absent", "-", "-"]),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.map((val) => `"${val}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Attendance_${selected.class_name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Class attendance report exported to CSV");
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Class Timetable & Sessions
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent/20 text-accent-foreground border border-accent/30">
              <BookOpen className="h-3 w-3" /> Quorum Audit
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Schedule lecture windows and automatically compute present vs absent rosters with biometric verification.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadSessions} className="h-9">
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh Timetable
        </Button>
      </div>

      {/* Grid: Create Form (Left) & Scheduled Timetable (Right) */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">

        {/* Create Session Form (4 cols) */}
        <section className="lg:col-span-4 rounded-xl border border-border bg-card p-5 shadow-2xs space-y-4">
          <div className="flex items-center gap-2 text-foreground font-semibold text-base border-b border-border/60 pb-3">
            <span className="p-1.5 rounded-md bg-primary/10 text-primary">
              <CalendarClock className="h-4 w-4" />
            </span>
            <span>Schedule Lecture</span>
          </div>

          <div className="space-y-3.5">
            <div className="space-y-1">
              <Label htmlFor="class-name" className="text-xs font-medium text-foreground">
                Course & Module Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="class-name"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="e.g. CS401 — Advanced Algorithms"
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="professor" className="text-xs font-medium text-foreground">
                Lecturer / Professor
              </Label>
              <Input
                id="professor"
                value={professor}
                onChange={(e) => setProfessor(e.target.value)}
                placeholder="e.g. Prof. Alan Turing"
                className="h-9 text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="camera" className="text-xs font-medium text-foreground">
                Assigned Hall / Camera Sector (Optional)
              </Label>
              <Input
                id="camera"
                value={camera}
                onChange={(e) => setCamera(e.target.value)}
                placeholder="e.g. Main Auditorium A1 (leave blank for all)"
                className="h-9 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <Label htmlFor="start" className="text-xs font-medium text-foreground">
                  Starts At
                </Label>
                <Input
                  id="start"
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="end" className="text-xs font-medium text-foreground">
                  Ends At
                </Label>
                <Input
                  id="end"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <Button
              onClick={createSession}
              disabled={saving}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium h-9.5 mt-2 shadow-xs"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Scheduling...
                </>
              ) : (
                "Schedule Session"
              )}
            </Button>
          </div>
        </section>

        {/* Timetable List (8 cols) */}
        <section className="lg:col-span-8 rounded-xl border border-border bg-card p-5 shadow-2xs space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-md bg-secondary/10 text-secondary">
                <Clock className="h-4 w-4" />
              </span>
              <h2 className="font-semibold text-base text-foreground">Session Directory</h2>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-mono">
                {sessions.length} total
              </span>
            </div>
            <span className="text-xs text-muted-foreground hidden sm:inline">Click any lecture to audit attendance</span>
          </div>

          <div className="divide-y divide-border/80 overflow-y-auto max-h-[480px]">
            {sessions.length === 0 && (
              <div className="py-12 text-center text-muted-foreground space-y-2">
                <CalendarClock className="h-8 w-8 mx-auto text-muted-foreground/60" />
                <p className="text-sm font-medium">No sessions scheduled yet</p>
                <p className="text-xs">Use the form on the left to schedule your first lecture window.</p>
              </div>
            )}

            {sessions.map((s) => {
              const currentTime = new Date();
              const startDt = new Date(s.starts_at);
              const endDt = new Date(s.ends_at);
              const isRunning = currentTime >= startDt && currentTime <= endDt;
              const isUpcoming = currentTime < startDt;
              const isSelected = selected?.id === s.id;

              return (
                <div
                  key={s.id}
                  className={`py-3.5 px-3 rounded-lg flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-muted/40"
                  }`}
                >
                  <button
                    type="button"
                    className="text-left flex-1 min-w-0"
                    onClick={() => openSession(s)}
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm text-foreground truncate">{s.class_name}</p>
                      {isRunning && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-success/15 text-success border border-success/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> LIVE NOW
                        </span>
                      )}
                      {isUpcoming && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                          UPCOMING
                        </span>
                      )}
                      {!isRunning && !isUpcoming && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                          CONCLUDED
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {startDt.toLocaleDateString([], { month: "short", day: "numeric" })} ·{" "}
                        {startDt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {endDt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {s.professor_name && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" /> {s.professor_name}
                        </span>
                      )}
                      {s.camera_label && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" /> {s.camera_label}
                        </span>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center space-x-1 shrink-0">
                    {!isRunning && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-medium"
                        disabled={startingSessionId === s.id || stoppingSessionId === s.id}
                        onClick={() => startSession(s)}
                        title="Start lecture right now"
                      >
                        {startingSessionId === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 mr-1 fill-current text-success" /> Start
                          </>
                        )}
                      </Button>
                    )}

                    {isRunning && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-8 text-xs font-medium shadow-xs"
                        disabled={startingSessionId === s.id || stoppingSessionId === s.id}
                        onClick={() => stopSession(s)}
                        title="Conclude lecture right now"
                      >
                        {stoppingSessionId === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Square className="h-3.5 w-3.5 mr-1 fill-current" /> End Session
                          </>
                        )}
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label="Delete session"
                      onClick={() => removeSession(s.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Selected Session Audit Detail View */}
      {selected && (
        <section className="rounded-xl border border-border bg-card p-5 sm:p-6 shadow-2xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">
                  Attendance Audit: {selected.class_name}
                </h2>
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-primary/10 text-primary">
                  {present.length} of {enrolled.length} Verified
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Window: {new Date(selected.starts_at).toLocaleString()} → {new Date(selected.ends_at).toLocaleString()}
                {selected.professor_name ? ` · Lecturer: ${selected.professor_name}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportClassAttendanceCSV} className="h-9">
                <Download className="h-4 w-4 mr-1.5" /> Export Class CSV
              </Button>
            </div>
          </div>

          {/* Quorum Progress Bar Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Quorum Compliance
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground tabular-nums">{quorumRate}%</span>
                <span className="text-xs text-muted-foreground">minimum 75% target</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    quorumRate >= 75 ? "bg-success" : "bg-warning"
                  }`}
                  style={{ width: `${Math.min(100, quorumRate)}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Verified Present
              </span>
              <p className="text-3xl font-bold text-success tabular-nums">{present.length}</p>
              <p className="text-xs text-muted-foreground">Recognized by biometric camera during class</p>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Unaccounted / Absent
              </span>
              <p className="text-3xl font-bold text-destructive tabular-nums">{absent.length}</p>
              <p className="text-xs text-muted-foreground">Enrolled students without detection record</p>
            </div>
          </div>

          {/* Filter Bar & Tab View */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="flex border border-border rounded-lg bg-muted/30 p-0.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setAttendanceTab("all")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  attendanceTab === "all" ? "bg-card text-foreground shadow-2xs" : "text-muted-foreground"
                }`}
              >
                All Students ({enrolled.length})
              </button>
              <button
                type="button"
                onClick={() => setAttendanceTab("present")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  attendanceTab === "present" ? "bg-card text-success shadow-2xs" : "text-muted-foreground"
                }`}
              >
                Present ({present.length})
              </button>
              <button
                type="button"
                onClick={() => setAttendanceTab("absent")}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  attendanceTab === "absent" ? "bg-card text-destructive shadow-2xs" : "text-muted-foreground"
                }`}
              >
                Absent ({absent.length})
              </button>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search student roster..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
          </div>

          {/* Rosters Breakdown */}
          {loading ? (
            <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Auditing session detections...
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Present Column */}
              {(attendanceTab === "all" || attendanceTab === "present") && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <CheckCircle2 className="h-4 w-4 text-success" /> Present Cohort ({present.length})
                  </h3>
                  <ul className="space-y-2 text-sm max-h-[360px] overflow-y-auto">
                    {present.length === 0 && (
                      <li className="p-4 text-center text-xs text-muted-foreground rounded-lg border border-dashed border-border">
                        No students recognized during this session.
                      </li>
                    )}
                    {present
                      .filter((p) => p.person_name.toLowerCase().includes(searchFilter.toLowerCase()))
                      .map((p) => (
                        <li
                          key={p.person_name}
                          className="flex items-center justify-between rounded-lg bg-card border border-border/80 px-3.5 py-2.5 shadow-2xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-success" />
                            <span className="font-semibold text-foreground">{p.person_name}</span>
                          </div>
                          <span className="text-muted-foreground text-xs font-mono">
                            {new Date(p.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · {p.camera_label}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {/* Absent Column */}
              {(attendanceTab === "all" || attendanceTab === "absent") && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                    <XCircle className="h-4 w-4 text-destructive" /> Absent / Unaccounted ({absent.length})
                  </h3>
                  <ul className="space-y-2 text-sm max-h-[360px] overflow-y-auto">
                    {absent.length === 0 && (
                      <li className="p-4 text-center text-xs text-success rounded-lg border border-dashed border-success/30 bg-success/5">
                        Perfect attendance! Every enrolled student was verified.
                      </li>
                    )}
                    {absent
                      .filter((n) => n.toLowerCase().includes(searchFilter.toLowerCase()))
                      .map((n) => (
                        <li
                          key={n}
                          className="flex items-center justify-between rounded-lg bg-card border border-border/60 px-3.5 py-2.5 shadow-2xs text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-destructive" />
                            <span className="font-medium text-foreground">{n}</span>
                          </div>
                          <span className="text-destructive font-medium text-[11px]">Unmarked</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
