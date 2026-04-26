// ─────────────────────────────────────────────────────────────
// OppVerse – sync-opportunities Edge Function
// Uses Gemini 2.0 Flash + Google Search grounding (SINGLE CALL)
// Consolidated into 1 API request to avoid 429 rate limits.
// ─────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

const GEMINI_SEARCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const DB_TABLE = 'opportunities';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Single comprehensive Gemini search call ──────────────────
async function scrapeWithGemini(log: string[]): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const prompt = `Today is ${today}.

Search the web and find at least 15 real, currently open opportunities in India — including hackathons, internships, tech events, coding competitions, and workshops. Look on sites like unstop.com, devfolio.co, internshala.com, hackerearth.com, LinkedIn, and similar platforms.

Only include opportunities that:
- Are open for registration/application RIGHT NOW
- Have a deadline AFTER ${today}
- Have a real direct link (not a news article or blog post)

Return ONLY a valid JSON array (no markdown, no explanation). Each object must have:
- "title": full event/opportunity name
- "organization": organizer or company name
- "category": one of "Hackathon", "Internship", "Event", "Workshop"
- "location": Indian city name, or "Online", or "India"
- "mode": "Online", "Offline", or "Hybrid"
- "deadline": ISO date string YYYY-MM-DD (use "${twoWeeks}" if truly unknown)
- "link": direct registration/application URL starting with https://
- "skills": comma-separated skills like "Python, ML" or "Open to all"
- "eligibility": e.g. "UG Students", "Open to all", "Engineering students"
- "team_size": e.g. "1-4 members", "Individual", or "Check Website"
- "venue": venue address, or "Online", or "Check Website"

Return ONLY the JSON array. Example format:
[{"title":"...","organization":"...","category":"Hackathon","location":"Online","mode":"Online","deadline":"2025-05-30","link":"https://...","skills":"Python, ML","eligibility":"Open to all","team_size":"2-4 members","venue":"Online"}]`;

  try {
    log.push('Sending single Gemini request with Google Search...');

    const res = await fetch(GEMINI_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      log.push(`Gemini HTTP ${res.status}: ${errText.slice(0, 300)}`);
      return [];
    }

    const json = await res.json();
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text || '';

    log.push(`Gemini responded, raw length: ${raw.length} chars`);

    // Parse JSON — strip markdown code fences if present
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { parsed = []; }
      }
    }

    if (!Array.isArray(parsed)) {
      log.push('Gemini response was not a JSON array');
      return [];
    }

    // Validate each entry has required fields and a real link
    const valid = parsed.filter(o =>
      o.title &&
      o.link &&
      typeof o.link === 'string' &&
      o.link.startsWith('http')
    );

    log.push(`Parsed: ${parsed.length} total, ${valid.length} valid with real links`);
    return valid;

  } catch (err) {
    log.push(`Gemini exception: ${err.message}`);
    return [];
  }
}

// ── Deduplicate by link ──────────────────────────────────────
function deduplicateByLink(items: any[]): any[] {
  const seen = new Set<string>();
  return items.filter(o => {
    if (seen.has(o.link)) return false;
    seen.add(o.link);
    return true;
  });
}

// ── Check deadline is still in future ───────────────────────
function isFuture(deadline: string): boolean {
  if (!deadline) return true;
  try { return new Date(deadline) > new Date(); }
  catch { return true; }
}

// ── MAIN ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const log: string[] = [];
  log.push(`Sync started at ${new Date().toISOString()}`);
  log.push('Using Gemini 2.0 Flash with Google Search grounding (single call)');

  // Single Gemini call — no parallel requests = no rate limit
  const items = await scrapeWithGemini(log);

  // Clean up
  const unique = deduplicateByLink(items);
  const active = unique.filter(o => isFuture(o.deadline));
  const final  = active.slice(0, 25);

  log.push(`Final count after dedup + expiry filter: ${final.length}`);

  if (final.length === 0) {
    log.push('No valid opportunities returned. Check API key and quota.');
    return new Response(
      JSON.stringify({ log, count: 0, warning: 'No opportunities found' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Upsert to Supabase
  const { data: inserted, error: dbError } = await supabase
    .from(DB_TABLE)
    .upsert(final, { onConflict: 'link', ignoreDuplicates: true })
    .select();

  if (dbError) {
    log.push(`DB Error: ${dbError.message}`);
  } else {
    log.push(`Saved to DB: ${inserted?.length ?? 0} new entries`);
  }

  return new Response(
    JSON.stringify({ log, count: final.length, saved: inserted?.length ?? 0 }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});