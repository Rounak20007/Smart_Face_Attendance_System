import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw,
  Camera as CamIcon,
  Download,
  Search,
  Users,
  Activity,
  X,
  Eye,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ClipboardList,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";

export const Route = createFileRoute("/logs")({
  head: () => ({
    meta: [
      { title: "Attendance Logs & Verification Audit — FaceMark" },
      { name: "description", content: "Browse and export recorded biometric attendance with photographic audit snapshots." },
    ],
  }),
  component: LogsPage,
});

type Row = {
  id: string;
  person_name: string;
  camera_label: string;
  snapshot_url: string | null;
  created_at: string;
  signed?: string;
};

function LogsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCamera, setSelectedCamera] = useState("all");
  const [modalSnapshot, setModalSnapshot] = useState<{ url: string; name: string; time: string; camera: string } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("attendance")
      .select("id, person_name, camera_label, snapshot_url, created_at")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      toast.error("Could not load attendance logs", { description: error.message });
      setLoading(false);
      return;
    }

    const fetchedRows = (data ?? []) as Row[];

    // Sign snapshot URLs for secure preview
    const paths = fetchedRows.filter((r) => r.snapshot_url).map((r) => r.snapshot_url!) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from("attendance-snapshots")
        .createSignedUrls(paths, 60 * 60 * 24);
      const map = new Map<string, string>();
      signed?.forEach((s) => {
        if (s.path && s.signedUrl) map.set(s.path, s.signedUrl);
      });
      for (const r of fetchedRows) {
        if (r.snapshot_url) r.signed = map.get(r.snapshot_url);
      }
    }
    setRows(fetchedRows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Unique camera sectors
  const cameraLabels = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.camera_label) set.add(r.camera_label);
    });
    return Array.from(set);
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const matchesSearch =
        r.person_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.camera_label.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCamera = selectedCamera === "all" || r.camera_label === selectedCamera;
      return matchesSearch && matchesCamera;
    });
  }, [rows, searchTerm, selectedCamera]);

  // Paginated rows
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;

  // Chart analytics: Hourly distribution of recognitions
  const hourlyData = useMemo(() => {
    const hoursMap: Record<string, number> = {};
    for (let i = 8; i <= 18; i++) {
      const label = `${i > 12 ? i - 12 : i} ${i >= 12 ? "PM" : "AM"}`;
      hoursMap[label] = 0;
    }

    rows.forEach((r) => {
      const d = new Date(r.created_at);
      const hour = d.getHours();
      if (hour >= 8 && hour <= 18) {
        const label = `${hour > 12 ? hour - 12 : hour} ${hour >= 12 ? "PM" : "AM"}`;
        hoursMap[label] = (hoursMap[label] || 0) + 1;
      }
    });

    return Object.entries(hoursMap).map(([hour, count]) => ({
      hour,
      count,
    }));
  }, [rows]);

  const uniquePeopleToday = useMemo(() => {
    const today = new Date().toDateString();
    const set = new Set<string>();
    rows.forEach((r) => {
      if (new Date(r.created_at).toDateString() === today) {
        set.add(r.person_name);
      }
    });
    return set.size;
  }, [rows]);

  // CSV Exporter
  const exportCSV = () => {
    if (filteredRows.length === 0) return toast.error("No records to export");

    const headers = ["Record ID", "Student Name", "Camera Sector", "Timestamp (ISO)", "Local Time", "Snapshot URL"];
    const csvRows = filteredRows.map((r) => [
      r.id,
      r.person_name,
      r.camera_label,
      r.created_at,
      new Date(r.created_at).toLocaleString(),
      r.signed || r.snapshot_url || "N/A",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...csvRows].map((e) => e.map((val) => `"${val}"`).join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `FaceMark_Attendance_Audit_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success(`Exported ${filteredRows.length} attendance records to CSV`);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Attendance Audit Logs
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary/15 text-secondary border border-secondary/25">
              <ClipboardList className="h-3 w-3" /> Photographic Proof
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Complete tamper-evident log of student detections with verified timestamps and snapshot proof.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="h-9">
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-9">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Analytics KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Total Audit Records</span>
            <span className="p-1.5 rounded-md bg-primary/10 text-primary">
              <ClipboardList className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {rows.length}
          </p>
          <p className="text-xs text-muted-foreground">Recent detection events</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Unique Students Today</span>
            <span className="p-1.5 rounded-md bg-success/10 text-success">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {uniquePeopleToday}
          </p>
          <p className="text-xs text-muted-foreground">Distinct biometric verifications</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Active Sectors</span>
            <span className="p-1.5 rounded-md bg-accent/20 text-accent-foreground">
              <CamIcon className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {cameraLabels.length}
          </p>
          <p className="text-xs text-muted-foreground">Camera capture points</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-4.5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Snapshot Storage</span>
            <span className="p-1.5 rounded-md bg-secondary/15 text-secondary">
              <Sparkles className="h-4 w-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums">
            {rows.filter((r) => r.snapshot_url).length}
          </p>
          <p className="text-xs text-muted-foreground">Verified image proofs stored</p>
        </div>
      </div>

      {/* Hourly Trend Bar Chart */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Daily Detection Density (Peak Lecture Hours)
          </h2>
          <span className="text-xs text-muted-foreground font-mono">8:00 AM – 6:00 PM</span>
        </div>

        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickLine={false} allowDecimals={false} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-popover border border-border p-2 rounded shadow-md text-xs">
                        <p className="font-semibold text-foreground">{label}</p>
                        <p className="text-primary font-medium">{payload[0].value} verifications</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="count" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search student or camera sector..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="pl-9 h-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground hidden sm:inline" />
          <select
            value={selectedCamera}
            onChange={(e) => {
              setSelectedCamera(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full sm:w-56 h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Camera Sectors ({rows.length})</option>
            {cameraLabels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* High-Density Audit Table */}
      <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left p-3.5 font-semibold w-20">Proof</th>
                <th className="text-left p-3.5 font-semibold">Student Name</th>
                <th className="text-left p-3.5 font-semibold">Camera Sector</th>
                <th className="text-left p-3.5 font-semibold">Timestamp</th>
                <th className="text-right p-3.5 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {paginatedRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-muted-foreground">
                    {loading ? "Loading attendance records..." : "No matching attendance records found."}
                  </td>
                </tr>
              )}
              {paginatedRows.map((r) => {
                const dateObj = new Date(r.created_at);
                return (
                  <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      {r.signed ? (
                        <button
                          type="button"
                          onClick={() =>
                            setModalSnapshot({
                              url: r.signed!,
                              name: r.person_name,
                              time: dateObj.toLocaleString(),
                              camera: r.camera_label,
                            })
                          }
                          className="relative group block rounded-md overflow-hidden border border-border/80 hover:ring-2 hover:ring-primary focus:outline-hidden"
                          title="Click to inspect high-resolution snapshot"
                        >
                          <img src={r.signed} alt="" className="h-11 w-11 object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                            <Eye className="h-3.5 w-3.5" />
                          </div>
                        </button>
                      ) : (
                        <div className="h-11 w-11 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                          <CamIcon className="h-4 w-4" />
                        </div>
                      )}
                    </td>

                    <td className="p-3">
                      <div className="font-semibold text-foreground">{r.person_name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">ID: {r.id.slice(0, 8)}...</div>
                    </td>

                    <td className="p-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground border border-border">
                        {r.camera_label}
                      </span>
                    </td>

                    <td className="p-3">
                      <div className="text-xs font-medium text-foreground">{dateObj.toLocaleDateString()}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </div>
                    </td>

                    <td className="p-3 text-right">
                      {r.signed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setModalSnapshot({
                              url: r.signed!,
                              name: r.person_name,
                              time: dateObj.toLocaleString(),
                              camera: r.camera_label,
                            })
                          }
                          className="text-xs text-primary"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> View Proof
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Table Pagination Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          <div>
            Showing {(currentPage - 1) * pageSize + 1} to{" "}
            {Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} records
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="h-7.5 px-2 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Prev
            </Button>
            <span className="font-medium text-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="h-7.5 px-2 text-xs"
            >
              Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* High-Resolution Snapshot Lightbox Modal */}
      {modalSnapshot && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setModalSnapshot(null)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-success" />
                <h3 className="font-semibold text-sm text-foreground">
                  Biometric Verification Proof
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalSnapshot(null)}
                className="text-muted-foreground hover:text-foreground rounded p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="relative rounded-lg overflow-hidden border border-border bg-black aspect-video flex items-center justify-center">
                <img
                  src={modalSnapshot.url}
                  alt={modalSnapshot.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-muted/30 p-3 rounded-lg border border-border/60">
                <div>
                  <span className="text-muted-foreground block font-medium">Student Name</span>
                  <span className="font-bold text-foreground text-sm">{modalSnapshot.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block font-medium">Camera Sector</span>
                  <span className="font-semibold text-foreground">{modalSnapshot.camera}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground block font-medium">Timestamp</span>
                  <span className="font-mono text-foreground">{modalSnapshot.time}</span>
                </div>
              </div>
            </div>

            <div className="px-4 py-3 bg-muted/30 border-t border-border flex justify-end">
              <Button size="sm" onClick={() => setModalSnapshot(null)}>
                Close Proof
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
