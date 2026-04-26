// ─────────────────────────────────────────────────────────────
// OppVerse – sync-opportunities Edge Function
// Uses Gemini 2.0 Flash with Google Search Grounding to SCRAPE
// real, live opportunities from the web directly.
// ─────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;

// Use Gemini 2.0 Flash — supports google_search tool (live web access)
const GEMINI_SEARCH_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const DB_TABLE = 'opportunities';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Search queries Gemini will use to find opportunities ──
const SEARCH_QUERIES = [
  'hackathons open for registration India 2025 2026 site:unstop.com OR site:devfolio.co OR site:hackerearth.com',
  'internships open applications India students 2025 2026 site:internshala.com OR site:linkedin.com OR site:unstop.com',
  'tech events competitions India open registration 2025 2026 site:devfolio.co OR site:techgig.com OR site:hackerearth.com',
  'coding competitions open registration India 2025 2026',
  'college hackathon fellowship open applications India 2025 2026',
];

// ── Ask Gemini to search + return structured JSON ──────────
async function scrapeWithGemini(query: string, log: string[]): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];

  const prompt = `Today is ${today}.

Search the web for: "${query}"

Find real, currently open opportunities (hackathons, internships, events, competitions, workshops, fellowships).
Only include opportunities where:
- Registration/application is OPEN right now
- Deadline has NOT passed yet (after ${today})
- The link goes directly to the registration/details page (not a blog or news article)

For each opportunity found, return a JSON array. Each object must have EXACTLY these fields:
- "title": full name of the event/opportunity
- "organization": company or organizer name
- "category": one of "Hackathon", "Internship", "Event", "Workshop"
- "location": city name (Indian city) or "Online" or "India"
- "mode": "Online", "Offline", or "Hybrid"
- "deadline": ISO date string (YYYY-MM-DD) of registration deadline. If unknown, use "${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}"
- "link": direct URL to the registration/application page
- "skills": comma-separated relevant skills (e.g. "Python, ML, Web Dev") or "Open to all"
- "eligibility": who can apply (e.g. "UG Students", "Open to all", "Engineers")
- "team_size": team size if applicable (e.g. "1-4 members", "Individual", "Check Website")
- "venue": full venue address or "Online" or "Check Website"

Return ONLY a valid JSON array. No markdown, no explanation. If you find no valid results, return [].`;

  try {
    const res = await fetch(GEMINI_SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],  // ← This enables live web search
        generationConfig: {
          temperature: 0.1,   // low temp = more factual, less creative
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      log.push(`Gemini HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return [];
    }

    const json = await res.json();
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text || '';

    log.push(`Query "${query.slice(0, 40)}..." → raw len: ${raw.length}`);

    // Parse JSON from response
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim());
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { parsed = []; }
      }
    }

    if (!Array.isArray(parsed)) return [];

    // Validate and clean each item
    const valid = parsed.filter(o =>
      o.title && typeof o.title === 'string' &&
      o.link && typeof o.link === 'string' && o.link.startsWith('http')
    );

    log.push(`  → ${valid.length} valid items`);
    return valid;

  } catch (err) {
    log.push(`Gemini error for query "${query.slice(0, 40)}...": ${err.message}`);
    return [];
  }
}

// ── Deduplicate by link ────────────────────────────────────
function deduplicateByLink(items: any[]): any[] {
  const seen = new Set<string>();
  return items.filter(o => {
    if (seen.has(o.link)) return false;
    seen.add(o.link);
    return true;
  });
}

// ── Validate deadline is in the future ────────────────────
function isFuture(deadline: string): boolean {
  try {
    return new Date(deadline) > new Date();
  } catch {
    return true; // keep if unparseable
  }
}

// ── MAIN ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const log: string[] = [];
  log.push(`Sync started at ${new Date().toISOString()}`);
  log.push(`Using Gemini 2.0 Flash with Google Search grounding`);

  // Run all search queries in parallel
  const results = await Promise.allSettled(
    SEARCH_QUERIES.map(q => scrapeWithGemini(q, log))
  );

  const allItems: any[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allItems.push(...r.value);
  }

  log.push(`Total scraped: ${allItems.length}`);

  // Deduplicate + filter expired
  const unique = deduplicateByLink(allItems);
  const active = unique.filter(o => isFuture(o.deadline));
  const final  = active.slice(0, 25); // cap at 25 entries per sync

  log.push(`After dedup + filter: ${final.length}`);

  if (final.length === 0) {
    log.push('No results — check Gemini API key or search tool access');
    return new Response(JSON.stringify({ log, count: 0, warning: 'No opportunities found' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Upsert to Supabase (deduplicate by link column)
  const { data: inserted, error: dbError } = await supabase
    .from(DB_TABLE)
    .upsert(final, {
      onConflict: 'link',
      ignoreDuplicates: true,
    })
    .select();

  if (dbError) {
    log.push(`DB Error: ${dbError.message}`);
  } else {
    log.push(`Saved to DB: ${inserted?.length ?? 0} new entries`);
  }

  return new Response(JSON.stringify({ log, count: final.length, saved: inserted?.length ?? 0 }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});