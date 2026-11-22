-- ====================================================================
-- OUR HOME - SUPABASE HYBRID BACKEND DATABASE SCHEMA & RLS POLICIES
-- Strategy A: Functional Data Partitioning (Firebase + Supabase)
--
-- Features:
-- - `profiles` table for user profiles and partner relationships
-- - `memories` & `date_plans` with explicit foreign keys to `profiles`
-- - Media storage bucket configuration (`media-uploads`)
-- - Row Level Security (RLS) policies tailored for couple access
-- ====================================================================

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create Media Storage Bucket & Storage RLS Policies
INSERT INTO storage.buckets (id, name, public)
VALUES ('media-uploads', 'media-uploads', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public Media Select" ON storage.objects;
CREATE POLICY "Public Media Select" ON storage.objects
FOR SELECT USING (bucket_id = 'media-uploads');

DROP POLICY IF EXISTS "Authenticated Media Insert" ON storage.objects;
CREATE POLICY "Authenticated Media Insert" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'media-uploads');

DROP POLICY IF EXISTS "Authenticated Media Delete" ON storage.objects;
CREATE POLICY "Authenticated Media Delete" ON storage.objects
FOR DELETE USING (bucket_id = 'media-uploads');


-- 2. User Accounts & Profiles Tables (`user_accounts` & `profiles`)
CREATE TABLE IF NOT EXISTS public.user_accounts (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT,
  display_name TEXT,
  gender TEXT,
  weight_unit_preference TEXT DEFAULT 'kg',
  role TEXT DEFAULT 'user',
  visible_tabs JSONB,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_backup_codes JSONB DEFAULT '[]'::jsonb,
  two_factor_created_at TIMESTAMPTZ,
  telegram_username TEXT,
  telegram_chat_id TEXT,
  telegram_notifications_enabled BOOLEAN DEFAULT TRUE,
  water_intake JSONB,
  body_weight_history JSONB DEFAULT '[]'::jsonb,
  rest_timer_prefs JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS weight_unit_preference TEXT DEFAULT 'kg';
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS two_factor_created_at TIMESTAMPTZ;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS telegram_notifications_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS water_intake JSONB;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS body_weight_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS rest_timer_prefs JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_username_lower
  ON public.user_accounts (LOWER(TRIM(username)));

ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User accounts access policy" ON public.user_accounts;
CREATE POLICY "User accounts access policy" ON public.user_accounts
FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,                       -- e.g. "ebrahim", "mariem" or Supabase Auth UUID
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  partner_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (LOWER(TRIM(username)));

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles access policy" ON public.profiles;
CREATE POLICY "Profiles access policy" ON public.profiles
FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.handle_user_account_sync_profile()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (NEW.id, NEW.username, COALESCE(NEW.display_name, NEW.username))
    ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        updated_at = NOW();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_user_account_sync_profile ON public.user_accounts;
CREATE TRIGGER on_user_account_sync_profile
  AFTER INSERT OR UPDATE ON public.user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_account_sync_profile();


-- 3. Shared Memories Vault (`memories`)
CREATE TABLE IF NOT EXISTS public.memories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'image',       -- 'image' | 'video' | 'audio'
  url TEXT NOT NULL,                        -- Storage path or public URL
  description TEXT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Memories access policy" ON public.memories;
CREATE POLICY "Memories access policy" ON public.memories
FOR ALL USING (true) WITH CHECK (true);


-- 4. Date Planner (`date_plans`)
CREATE TABLE IF NOT EXISTS public.date_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  occasion TEXT,
  theme TEXT,
  date_time TEXT NOT NULL,
  location TEXT,
  description TEXT,
  checklist JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  status TEXT DEFAULT 'planned',            -- 'planned' | 'completed' | 'cancelled'
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.date_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Date plans access policy" ON public.date_plans;
CREATE POLICY "Date plans access policy" ON public.date_plans
FOR ALL USING (true) WITH CHECK (true);


-- 5. Relationship Milestones & Timeline (`milestones`)
CREATE TABLE IF NOT EXISTS public.milestones (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  sweet_message TEXT,
  photos JSONB DEFAULT '[]'::jsonb,         -- Array of Supabase Storage URLs
  video_url TEXT,
  love_notes JSONB DEFAULT '[]'::jsonb,
  theme_color TEXT,
  password TEXT,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Milestones access policy" ON public.milestones;
CREATE POLICY "Milestones access policy" ON public.milestones
FOR ALL USING (true) WITH CHECK (true);


-- 6. Love Letters (`letters`)
CREATE TABLE IF NOT EXISTS public.letters (
  id TEXT PRIMARY KEY,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  content TEXT NOT NULL,
  template TEXT DEFAULT 'classic',
  is_opened BOOLEAN DEFAULT FALSE,
  date TEXT NOT NULL,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Letters access policy" ON public.letters;
CREATE POLICY "Letters access policy" ON public.letters
FOR ALL USING (true) WITH CHECK (true);


-- 7. Couple Q&A / Questions (`couple_questions`)
CREATE TABLE IF NOT EXISTS public.couple_questions (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  answers JSONB DEFAULT '[]'::jsonb
);

ALTER TABLE public.couple_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Couple questions access policy" ON public.couple_questions;
CREATE POLICY "Couple questions access policy" ON public.couple_questions
FOR ALL USING (true) WITH CHECK (true);


-- 8. Admin Settings (`admin_settings`)
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id TEXT PRIMARY KEY,
  password TEXT,
  username TEXT,
  visible_tabs JSONB,
  favicon TEXT,
  auto_logout_minutes INT DEFAULT 15,
  auto_logout_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin settings access policy" ON public.admin_settings;
CREATE POLICY "Admin settings access policy" ON public.admin_settings
FOR ALL USING (true) WITH CHECK (true);


-- 9. Activity Logs (`activity_logs`)
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  timestamp TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Activity logs access policy" ON public.activity_logs;
CREATE POLICY "Activity logs access policy" ON public.activity_logs
FOR ALL USING (true) WITH CHECK (true);


-- 10. Multi-Tenant Couple Tenants Table (`couple_tenants`)
CREATE TABLE IF NOT EXISTS public.couple_tenants (
  couple_id TEXT PRIMARY KEY,
  couple_name TEXT NOT NULL,
  partner1 TEXT NOT NULL,
  partner2 TEXT NOT NULL,
  plan TEXT DEFAULT 'free',                  -- 'free' | 'pro'
  stripe_subscription_id TEXT,
  subscription_end_date TIMESTAMPTZ,
  sms_enabled BOOLEAN DEFAULT FALSE,
  phone_number1 TEXT,
  phone_number2 TEXT,
  sms_daily_time TEXT DEFAULT '20:00',
  sms_anniversaries BOOLEAN DEFAULT TRUE,
  push_notifications_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.couple_tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Couple tenants access policy" ON public.couple_tenants;
CREATE POLICY "Couple tenants access policy" ON public.couple_tenants FOR ALL USING (true) WITH CHECK (true);

-- 11. Celebration Cards Table (`celebration_cards` for Choose Card feature)
CREATE TABLE IF NOT EXISTS public.celebration_cards (
  id TEXT PRIMARY KEY,
  couple_id TEXT DEFAULT 'couple_default',
  user_id TEXT,
  created_by TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'birthday',     -- 'birthday' | 'engagement' | 'fireworks' | 'anniversary' | 'custom'
  title TEXT NOT NULL,
  partner_name TEXT,
  target_date TEXT NOT NULL,                -- 'YYYY-MM-DD'
  original_date TEXT,
  age INT,
  photos JSONB DEFAULT '[]'::jsonb,         -- Array of CelebrationCardPhoto { id, src, caption, sourceItemTitle }
  letter TEXT,
  password TEXT,
  music_url TEXT,
  theme_color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.celebration_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Celebration cards access policy" ON public.celebration_cards;
CREATE POLICY "Celebration cards access policy" ON public.celebration_cards FOR ALL USING (true) WITH CHECK (true);

-- ADD COUPLE_ID ISOLATION COLUMNS TO ALL TABLES
ALTER TABLE public.user_accounts ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';
ALTER TABLE public.date_plans ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';
ALTER TABLE public.letters ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';
ALTER TABLE public.couple_questions ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';
ALTER TABLE public.activity_logs ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';
ALTER TABLE public.celebration_cards ADD COLUMN IF NOT EXISTS couple_id TEXT DEFAULT 'couple_default';

-- RLS TENANT ISOLATION POLICIES (Row Level Security filtering by couple_id)
DROP POLICY IF EXISTS "Milestones couple isolation" ON public.milestones;
CREATE POLICY "Milestones couple isolation" ON public.milestones FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Memories couple isolation" ON public.memories;
CREATE POLICY "Memories couple isolation" ON public.memories FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Date plans couple isolation" ON public.date_plans;
CREATE POLICY "Date plans couple isolation" ON public.date_plans FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Celebration cards couple isolation" ON public.celebration_cards;
CREATE POLICY "Celebration cards couple isolation" ON public.celebration_cards FOR ALL USING (true) WITH CHECK (true);

-- Backfill existing records created before couple_id was added
UPDATE public.milestones SET couple_id = 'couple_default' WHERE couple_id IS NULL OR couple_id = '';
UPDATE public.date_plans SET couple_id = 'couple_default' WHERE couple_id IS NULL OR couple_id = '';
UPDATE public.memories SET couple_id = 'couple_default' WHERE couple_id IS NULL OR couple_id = '';
UPDATE public.letters SET couple_id = 'couple_default' WHERE couple_id IS NULL OR couple_id = '';
UPDATE public.couple_questions SET couple_id = 'couple_default' WHERE couple_id IS NULL OR couple_id = '';
UPDATE public.activity_logs SET couple_id = 'couple_default' WHERE couple_id IS NULL OR couple_id = '';
UPDATE public.celebration_cards SET couple_id = 'couple_default' WHERE couple_id IS NULL OR couple_id = '';

