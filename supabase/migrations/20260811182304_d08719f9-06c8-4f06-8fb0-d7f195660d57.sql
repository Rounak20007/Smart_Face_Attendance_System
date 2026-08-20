CREATE TABLE public.class_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_name TEXT NOT NULL,
  professor_name TEXT,
  camera_label TEXT,
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_sessions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_sessions TO authenticated;
GRANT ALL ON public.class_sessions TO service_role;

ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view class sessions" ON public.class_sessions FOR SELECT USING (true);
CREATE POLICY "Anyone can create class sessions" ON public.class_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update class sessions" ON public.class_sessions FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete class sessions" ON public.class_sessions FOR DELETE USING (true);

CREATE INDEX idx_class_sessions_starts_at ON public.class_sessions (starts_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_class_sessions_updated_at
BEFORE UPDATE ON public.class_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();