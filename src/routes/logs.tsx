import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/button";
import { RefreshCw, Camera as CamIcon } from "lucide-react";

export const Route = createFileRoute("/logs")({
  head: () => ({
    meta: [
      { title: "Attendance Logs — FaceMark" },
      { name: "description", content: "Browse recorded attendance with time, camera and snapshot." },
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

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("attendance")
      .select("id, person_name, camera_label, snapshot_url, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as Row[];
    // sign URLs
    const paths = rows.filter((r) => r.snapshot_url).map((r) => r.snapshot_url!) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from("attendance-snapshots")
        .createSignedUrls(paths, 60 * 60);
      const map = new Map<string, string>();
      signed?.forEach((s) => { if (s.path && s.signedUrl) map.set(s.path, s.signedUrl); });
      for (const r of rows) if (r.snapshot_url) r.signed = map.get(r.snapshot_url);
    }
    setRows(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Attendance log</h1>
            <p className="text-muted-foreground mt-1">Latest 200 recognitions.</p>
          </div>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left p-3 font-medium">Snapshot</th>
                <th className="text-left p-3 font-medium">Person</th>
                <th className="text-left p-3 font-medium">Camera</th>
                <th className="text-left p-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">
                    No attendance records yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3">
                    {r.signed ? (
                      <a href={r.signed} target="_blank" rel="noreferrer">
                        <img src={r.signed} alt="" className="h-12 w-12 rounded object-cover border border-border" />
                      </a>
                    ) : (
                      <div className="h-12 w-12 rounded bg-muted flex items-center justify-center text-muted-foreground">
                        <CamIcon className="h-4 w-4" />
                      </div>
                    )}
                  </td>
                  <td className="p-3 font-medium">{r.person_name}</td>
                  <td className="p-3">{r.camera_label}</td>
                  <td className="p-3 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
