
-- Replace the overly permissive activity_logs INSERT policy with one that requires user_id match
DROP POLICY "System insert logs" ON public.activity_logs;
CREATE POLICY "Authenticated insert own logs" ON public.activity_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
