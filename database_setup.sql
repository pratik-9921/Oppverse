-- ==========================================================
-- OppVerse – Supabase Database Setup (COMPLETE v2)
-- Run this entire script in your Supabase SQL Editor
-- ==========================================================

-- 1. Create the opportunities table
CREATE TABLE IF NOT EXISTS public.opportunities (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title       text NOT NULL,
  organization text,
  category    text CHECK (category IN ('Hackathon','Internship','Event','Workshop','Sports','Other')),
  location    text,
  mode        text CHECK (mode IN ('Online','Offline','Hybrid')),
  deadline    text,
  link        text UNIQUE,
  skills      text,
  team_size   text,
  eligibility text,
  reg_fee     text DEFAULT 'Free',
  venue       text,
  created_at  timestamptz DEFAULT now()
);

-- 2. Create profiles table (auto-populated on signup via trigger)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name   text,
  email       text,
  role        text DEFAULT 'student' CHECK (role IN ('admin','student')),
  created_at  timestamptz DEFAULT now(),
  email_confirmed_at timestamptz
);

-- 3. Disable Row Level Security on opportunities (public platform)
ALTER TABLE public.opportunities DISABLE ROW LEVEL SECURITY;

-- 4. Enable RLS on profiles (users see only their own row; admin sees all)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4a. Allow users to read all profiles (for admin listing)
DROP POLICY IF EXISTS "Allow public read profiles" ON public.profiles;
CREATE POLICY "Allow public read profiles" ON public.profiles
  FOR SELECT USING (true);

-- 4b. Allow users to insert/update their own profile
DROP POLICY IF EXISTS "Allow own profile write" ON public.profiles;
CREATE POLICY "Allow own profile write" ON public.profiles
  FOR ALL USING (auth.uid() = id);

-- 5. Opportunities policies
DROP POLICY IF EXISTS "Allow public read" ON public.opportunities;
CREATE POLICY "Allow public read" ON public.opportunities
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public insert" ON public.opportunities;
CREATE POLICY "Allow public insert" ON public.opportunities
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public update" ON public.opportunities;
CREATE POLICY "Allow public update" ON public.opportunities
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Allow public delete" ON public.opportunities;
CREATE POLICY "Allow public delete" ON public.opportunities
  FOR DELETE USING (true);

-- 6. Trigger: create profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, created_at, email_confirmed_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'student',
    NEW.created_at,
    NEW.email_confirmed_at
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    email_confirmed_at = EXCLUDED.email_confirmed_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 7. Useful indexes
CREATE INDEX IF NOT EXISTS idx_opportunities_category   ON public.opportunities(category);
CREATE INDEX IF NOT EXISTS idx_opportunities_location   ON public.opportunities(location);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_at ON public.opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_email           ON public.profiles(email);

-- Done!
SELECT 'OppVerse database v2 setup complete!' AS status;
