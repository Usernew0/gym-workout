-- Complete Supabase Database Setup Script
-- Copy & Run in Supabase Dashboard -> SQL Editor

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. User Accounts Table
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
CREATE POLICY "User accounts access policy" ON public.user_accounts FOR ALL USING (true) WITH CHECK (true);

-- 2. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON public.profiles (LOWER(TRIM(username)));
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Profiles access policy" ON public.profiles;
CREATE POLICY "Profiles access policy" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

-- Auto-sync trigger from user_accounts to profiles & cascade username renames to workout_plans
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

  IF TG_OP = 'UPDATE' AND LOWER(TRIM(OLD.username)) IS DISTINCT FROM LOWER(TRIM(NEW.username)) THEN
    BEGIN
      UPDATE public.workout_plans
      SET owner_username = NEW.username,
          updated_at = NOW()
      WHERE LOWER(TRIM(owner_username)) = LOWER(TRIM(OLD.username));

      UPDATE public.workout_plans
      SET created_by = NEW.username
      WHERE LOWER(TRIM(created_by)) = LOWER(TRIM(OLD.username));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_user_account_sync_profile ON public.user_accounts;
CREATE TRIGGER on_user_account_sync_profile
  AFTER INSERT OR UPDATE ON public.user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_account_sync_profile();

-- 3. Activity Logs Table
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
CREATE POLICY "Activity logs access policy" ON public.activity_logs FOR ALL USING (true) WITH CHECK (true);

-- 4. Admin Settings Table
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id TEXT PRIMARY KEY,
  password TEXT,
  username TEXT,
  admin_accounts JSONB,
  visible_tabs JSONB,
  favicon TEXT,
  image_url TEXT,
  dim_percent INT,
  auto_logout_minutes INT DEFAULT 15,
  auto_logout_enabled BOOLEAN DEFAULT FALSE,
  login_lockout_seconds INT DEFAULT 60,
  login_max_attempts INT DEFAULT 5,
  telegram_config JSONB,
  two_factor_enabled BOOLEAN DEFAULT FALSE,
  two_factor_secret TEXT,
  two_factor_backup_codes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS admin_accounts JSONB;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS telegram_config JSONB;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS dim_percent INT;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS login_lockout_seconds INT DEFAULT 60;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS login_max_attempts INT DEFAULT 5;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE public.admin_settings ADD COLUMN IF NOT EXISTS two_factor_backup_codes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin settings access policy" ON public.admin_settings;
CREATE POLICY "Admin settings access policy" ON public.admin_settings FOR ALL USING (true) WITH CHECK (true);

-- 5. Workout Plans Table
CREATE TABLE IF NOT EXISTS public.workout_plans (
  id TEXT PRIMARY KEY,
  owner_username TEXT,
  title TEXT,
  description TEXT,
  instructions TEXT,
  sheet_name TEXT,
  default_weight_unit TEXT DEFAULT 'kg',
  weeks INT,
  has_rpe_column BOOLEAN DEFAULT FALSE,
  has_rir_column BOOLEAN DEFAULT FALSE,
  warmup_exercises JSONB DEFAULT '[]'::jsonb,
  warmup_logs JSONB DEFAULT '{}'::jsonb,
  exercises JSONB,
  source_file_name TEXT,
  created_by TEXT,
  assigned_by_admin BOOLEAN,
  progress JSONB,
  exercise_logs JSONB DEFAULT '{}'::jsonb,
  previous_logs JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS instructions TEXT;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS sheet_name TEXT;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS default_weight_unit TEXT DEFAULT 'kg';
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS has_rpe_column BOOLEAN DEFAULT FALSE;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS has_rir_column BOOLEAN DEFAULT FALSE;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS warmup_exercises JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS warmup_logs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS exercise_logs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.workout_plans ADD COLUMN IF NOT EXISTS previous_logs JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_workout_plans_owner_lower
  ON public.workout_plans (LOWER(TRIM(owner_username)));
ALTER TABLE public.workout_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workout plans access policy" ON public.workout_plans;
CREATE POLICY "Workout plans access policy" ON public.workout_plans FOR ALL USING (true) WITH CHECK (true);

-- 6. Storage Bucket Setup
INSERT INTO storage.buckets (id, name, public)
VALUES ('media-uploads', 'media-uploads', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public Media Select" ON storage.objects;
CREATE POLICY "Public Media Select" ON storage.objects FOR SELECT USING (bucket_id = 'media-uploads');

DROP POLICY IF EXISTS "Authenticated Media Insert" ON storage.objects;
CREATE POLICY "Authenticated Media Insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'media-uploads');

DROP POLICY IF EXISTS "Authenticated Media Delete" ON storage.objects;
CREATE POLICY "Authenticated Media Delete" ON storage.objects FOR DELETE USING (bucket_id = 'media-uploads');
