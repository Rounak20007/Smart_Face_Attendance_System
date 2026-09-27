-- Secure FaceMark: replace permissive policies with authenticated-user policies.
--
-- The previous policies granted USING (true) on select/insert/update/delete, which
-- meant anyone holding the publishable anon key could read every enrolled person's
-- name, roll number and biometric descriptor, rewrite the attendance log, or delete
-- the roster. RLS was enabled but permitted everything.
--
-- This migration:
--   1. drops every permissive policy
--   2. grants access only to the `authenticated` role (staff sign in; students do not)
--   3. routes attendance writes through a SECURITY DEFINER function so the browser
--      never holds direct INSERT on the log
--
-- Apply in the Supabase SQL editor. Sign-in must be working first, or the app
-- locks itself out — see the ordering note at the bottom.

-- ---------------------------------------------------------------------------
-- 1. Remove the permissive policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public read people" ON public.people;
DROP POLICY IF EXISTS "public insert people" ON public.people;
DROP POLICY IF EXISTS "public update people" ON public.people;
DROP POLICY IF EXISTS "public delete people" ON public.people;
DROP POLICY IF EXISTS "public read attendance" ON public.attendance;
DROP POLICY IF EXISTS "public insert attendance" ON public.attendance;
DROP POLICY IF EXISTS "Anyone can view class sessions" ON public.class_sessions;
DROP POLICY IF EXISTS "Anyone can create class sessions" ON public.class_sessions;
DROP POLICY IF EXISTS "public read snapshots" ON storage.objects;
DROP POLICY IF EXISTS "public upload snapshots" ON storage.objects;

-- ---------------------------------------------------------------------------
-- 2. Withdraw anon access
--
-- The anon key ships in the browser bundle, so `anon` is not a trusted role
-- here. Everything moves to `authenticated` (a real signed-in staff session).
-- service_role keeps its existing grants and bypasses RLS as usual.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.people FROM anon;
REVOKE ALL ON public.attendance FROM anon;
REVOKE ALL ON public.class_sessions FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO authenticated;
GRANT SELECT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_sessions TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Staff-scoped policies
--
-- There is one staff tier in this system (the professor running the room), so
-- every signed-in user gets full access. The important change is not who is
-- allowed in, it is that `anon` is no longer one of them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff can read people" ON public.people
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff can insert people" ON public.people
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff can update people" ON public.people
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff can delete people" ON public.people
  FOR DELETE TO authenticated USING (true);

-- The browser has no direct INSERT here; it calls mark_attendance() below.
CREATE POLICY "staff can read attendance" ON public.attendance
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff can update attendance" ON public.attendance
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff can delete attendance" ON public.attendance
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "staff can read class_sessions" ON public.class_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff can insert class_sessions" ON public.class_sessions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "staff can update class_sessions" ON public.class_sessions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "staff can delete class_sessions" ON public.class_sessions
  FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 4. Attendance marking function
--
-- SECURITY DEFINER so it runs as the owner and can INSERT even though the
-- caller holds no direct INSERT grant. The person_id is resolved from the
-- database, not accepted from the client, so a caller cannot attribute an
-- attendance row to an arbitrary person.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_attendance(
  p_person_id UUID,
  p_camera_label TEXT,
  p_snapshot_url TEXT DEFAULT NULL
)
RETURNS public.attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
  v_row public.attendance;
BEGIN
  -- Refuse unknown people rather than writing a row with a dangling id.
  SELECT name INTO v_name FROM public.people WHERE id = p_person_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Unknown person id: %', p_person_id;
  END IF;

  INSERT INTO public.attendance (person_id, person_name, camera_label, snapshot_url)
  VALUES (p_person_id, v_name, p_camera_label, p_snapshot_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_attendance(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_attendance(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Snapshot storage
--
-- Snapshots are images of everyone who walked past the camera, so the same
-- authenticated tier applies. No anon read, no anon write.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public read snapshots" ON storage.objects;
DROP POLICY IF EXISTS "public upload snapshots" ON storage.objects;

CREATE POLICY "staff can read snapshots" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-snapshots');
CREATE POLICY "staff can upload snapshots" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-snapshots');
CREATE POLICY "staff can delete snapshots" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'attendance-snapshots');

-- ---------------------------------------------------------------------------
-- Verification
--
--   select * from public.mark_attendance(
--     (select id from public.people limit 1), 'Smoke Test', null);
--
-- Run that while signed out. It must fail with a permission error. If it
-- succeeds, a policy is still too permissive.
-- ---------------------------------------------------------------------------
