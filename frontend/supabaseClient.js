// ============================================================
// OppVerse – supabaseClient.js
// CENTRAL CONFIGURATION FILE
// ============================================================
// All credentials live here. Both script.js and admin.js import
// from this file — you only need to change things in ONE place.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Supabase Project Settings ─────────────────────────────
// Project ref: kzjaxtwbapgnauhvlexj
export const SUPABASE_URL      = 'https://kzjaxtwbapgnauhvlexj.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6amF4dHdiYXBnbmF1aHZsZXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMzY1MTcsImV4cCI6MjA5MjcxMjUxN30.Txl6krC5aBylKp7u27FL89HXNCUneGcXIoIjseAz91M';

// ── Supabase Edge Function URL (optional) ─────────────────
// If you deploy the Edge Function, set its full invoke URL here.
// Otherwise, the app uses the client-side Gemini fallback.
export const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/sync-opportunities`;

// ── Supabase Client (shared instance) ────────────────────
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Database Table Name ───────────────────────────────────
// All queries must use this constant — never hardcode the string.
export const DB_TABLE = 'opportunities';

// ── Gemini AI Settings ────────────────────────────────────
export const GEMINI_MODEL    = 'gemini-1.5-flash';
export const GEMINI_ENDPOINT = (apiKey) =>
  `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

// Gemini API key — pre-configured (also cached to localStorage on init)
export const GEMINI_API_KEY   = 'AIzaSyAwEnqES6k9nll3pd_K3EYB3aBhex14GGI';
export const GEMINI_KEY_STORE = 'oppverse_gemini_key';
