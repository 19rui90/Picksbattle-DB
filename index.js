require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // já é a service_role
const BACKEND_API_KEY = process.env.BACKEND_API_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || !BACKEND_API_KEY) {
  console.error('ERRO: define SUPABASE_URL, SUPABASE_SERVICE_KEY, BACKEND_API_KEY nas env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(helmet());
app.use(express.json({ limit: '200kb' }));
app.use(cors());

// rate limit (ex.: 120 req/min)
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

// ===========================
// Middleware para autenticação
// ===========================
function requireApiKey(req, res, next) {
  const key = req.header('x-api-key') || req.query.api_key;
  if (!key || key !== BACKEND_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ===========================
// endpoint /players
// ===========================
app.post('/players', requireApiKey, async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];

  const cleaned = payload.map(p => ({
    id: p.id,
    name: p.name || null,
    multiplier: p.multiplier !== undefined ? Number(p.multiplier) : null,
    country: p.country || null,
    continent: p.continent || null,
    division: p.division || null,
    national_league: p.national_league || [],
    national_cup: p.national_cup || [],
    champions_cup: p.champions_cup || [],
    challenge_cup: p.challenge_cup || [],
    conference_cup: p.conference_cup || [],
    trophies_total: p.trophies_total || 0,
    register_date: p.register_date || null,
    register_season: p.register_season || null,
    active: p.active || { status: 'Active', last_game: null },
    season: p.season || 1,
    created_at: p.created_at || undefined,
    updated_at: p.updated_at || undefined
  }));

  try {
    const { data, error } = await supabase
      .from('players')
      .upsert(cleaned, { onConflict: 'id', returning: 'representation' });
    if (error) return res.status(400).json({ error });
    return res.json({ data });
  } catch (err) {
    console.error('ERROR /players', err);
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
});

// ===========================
// endpoint /season_days
// ===========================
app.post('/season_days', requireApiKey, async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  try {
    const { data, error } = await supabase
      .from('season_days')
      .upsert(payload, { onConflict: ['season', 'day'], returning: 'representation' });
    if (error) return res.status(400).json({ error });
    return res.json({ data });
  } catch (err) {
    console.error('ERROR /season_days', err);
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
});

// ===========================
// endpoint /logs -> Supabase Storage
// ===========================
app.post('/logs', requireApiKey, async (req, res) => {
  try {
    const body = req.body;
    const logText = typeof body === 'string' ? body : JSON.stringify(body, null, 2);

    const now = new Date();
    const pad = n => n.toString().padStart(2, '0');
    const filename = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;

    const { error } = await supabase
      .storage
      .from('logs') // bucket = logs
      .upload(filename, logText, {
        contentType: 'text/plain',
        upsert: true
      });

    if (error) throw error;

    return res.json({ status: 'ok', file: filename });
  } catch (err) {
    console.error('ERROR /logs', err);
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
});

// ===========================
// root
// ===========================
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('PB backend ok'));
app.listen(port, () => console.log(`PB backend listening on ${port}`));
