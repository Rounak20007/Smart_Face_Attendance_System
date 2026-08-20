
CREATE TABLE public.people (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  descriptors JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO anon, authenticated;
GRANT ALL ON public.people TO service_role;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read people" ON public.people FOR SELECT USING (true);
CREATE POLICY "public insert people" ON public.people FOR INSERT WITH CHECK (true);
CREATE POLICY "public update people" ON public.people FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete people" ON public.people FOR DELETE USING (true);

CREATE TABLE public.attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
  person_name TEXT NOT NULL,
  camera_label TEXT NOT NULL,
  snapshot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO anon, authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read attendance" ON public.attendance FOR SELECT USING (true);
CREATE POLICY "public insert attendance" ON public.attendance FOR INSERT WITH CHECK (true);

CREATE INDEX idx_attendance_created_at ON public.attendance(created_at DESC);
