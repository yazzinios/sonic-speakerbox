-- ============================================================
-- Library Tracks — persist uploaded tracks per user
-- so they survive browser close / re-login
-- ============================================================

CREATE TABLE public.library_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  original_name TEXT NOT NULL,
  server_name TEXT NOT NULL,   -- filename on the streaming server (/data/uploads/<server_name>)
  size_bytes INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.library_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own library tracks"
  ON public.library_tracks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_library_tracks_user ON public.library_tracks(user_id);
