-- Add voice_name column to announcements for TTS voice persistence
-- Also add scheduled_time for announcement scheduling

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS voice_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS scheduled_time TEXT DEFAULT '';

-- The existing audio_url column will now store the server filename (not a URL)
-- This is backwards compatible since it was TEXT NULL before
