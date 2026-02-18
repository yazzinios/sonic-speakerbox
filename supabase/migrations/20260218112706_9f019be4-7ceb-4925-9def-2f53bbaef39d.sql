
-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- DJ Settings table (station config per user)
CREATE TABLE public.dj_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  station_name TEXT NOT NULL DEFAULT 'DJ CONSOLE',
  dj_name TEXT DEFAULT '',
  bg_image TEXT DEFAULT '',
  jingle_url TEXT DEFAULT '',
  jingle_name TEXT DEFAULT 'Default (tan-tan-tan)',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dj_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings" ON public.dj_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.dj_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.dj_settings FOR UPDATE USING (auth.uid() = user_id);

-- Channels table
CREATE TABLE public.channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  deck_id TEXT NOT NULL CHECK (deck_id IN ('A','B','C','D')),
  name TEXT NOT NULL DEFAULT 'Channel',
  code TEXT NOT NULL,
  bg_image TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, deck_id)
);

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own channels" ON public.channels FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own channels" ON public.channels FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own channels" ON public.channels FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own channels" ON public.channels FOR DELETE USING (auth.uid() = user_id);
-- Listeners need to look up channels by code (public read for code lookup)
CREATE POLICY "Anyone can view channels by code" ON public.channels FOR SELECT USING (true);

-- Playlists table
CREATE TABLE public.playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  deck_id TEXT NOT NULL CHECK (deck_id IN ('A','B','C','D')),
  name TEXT NOT NULL DEFAULT 'Playlist',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own playlists" ON public.playlists FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Playlist tracks
CREATE TABLE public.playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID REFERENCES public.playlists(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('youtube', 'upload')),
  source_url TEXT NOT NULL,
  duration_seconds INTEGER DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own playlist tracks" ON public.playlist_tracks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.playlists WHERE id = playlist_tracks.playlist_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.playlists WHERE id = playlist_tracks.playlist_id AND user_id = auth.uid()));

-- Announcements table
CREATE TABLE public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('entrance', 'exit', 'evacuation', 'promo')),
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('audio', 'tts')),
  audio_url TEXT DEFAULT '',
  tts_text TEXT DEFAULT '',
  target_deck TEXT CHECK (target_deck IN ('A','B','C','D','all')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own announcements" ON public.announcements FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Schedules table
CREATE TABLE public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  deck_id TEXT NOT NULL CHECK (deck_id IN ('A','B','C','D')),
  playlist_id UUID REFERENCES public.playlists(id) ON DELETE SET NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  days_of_week INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own schedules" ON public.schedules FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_dj_settings_updated_at BEFORE UPDATE ON public.dj_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_playlists_updated_at BEFORE UPDATE ON public.playlists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_announcements_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
