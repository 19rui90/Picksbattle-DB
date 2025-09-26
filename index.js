require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');

// 👇 isto tem de vir logo no início
app.set("trust proxy", 1); 

// ===========================
// Escolha da conexão
// ===========================
let dbClient;
let connectionType;

if (process.env.DATABASE_URL) {
  // Ligação direta Postgres (recomendado)
  dbClient = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  connectionType = "Postgres (DATABASE_URL)";
} else if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  // Fallback: API da Supabase
  dbClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  connectionType = "Supabase REST API";
} else {
  console.error("❌ Nenhuma variável de conexão definida!");
  process.exit(1);
}

const BACKEND_API_KEY = process.env.BACKEND_API_KEY || null;

const app = express();
app.use(helmet());
app.use(express.json({ limit: '200kb' }));
app.use(cors());
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

// ===========================
// Middleware API Key
// ===========================
function requireApiKey(req, res, next) {
  const key = req.header('x-api-key') || req.query.api_key;
  if (BACKEND_API_KEY && key !== BACKEND_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ===========================
// /test-db -> Mostra conexão ativa
// ===========================
app.get('/test-db', async (req, res) => {
  try {
    if (connectionType === "Postgres (DATABASE_URL)") {
      const result = await dbClient.query("SELECT NOW()");
      return res.json({
        connection: connectionType,
        db_time: result.rows[0]
      });
    } else {
      const { data, error } = await dbClient.from("players").select("id").limit(1);
      if (error) throw error;
      return res.json({
        connection: connectionType,
        sample: data
      });
    }
  } catch (err) {
    console.error("❌ Erro em /test-db", err);
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// endpoint /players
// ===========================
app.post('/players', requireApiKey, async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];

  if (connectionType === "Postgres (DATABASE_URL)") {
    // Inserção direta via SQL
    const client = await dbClient.connect();
    try {
      await client.query("BEGIN");
      for (const p of payload) {
        const q = `
          INSERT INTO players (
            id, name, multiplier, country, continent, division,
            national_league, national_cup, champions_cup, challenge_cup, conference_cup,
            trophies_total, register_date, register_season, active, season,
            created_at, updated_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
            $12,$13,$14,$15,$16,$17,$18
          )
          ON CONFLICT (id) DO UPDATE SET
            name=EXCLUDED.name, multiplier=EXCLUDED.multiplier,
            country=EXCLUDED.country, continent=EXCLUDED.continent,
            division=EXCLUDED.division,
            national_league=EXCLUDED.national_league,
            national_cup=EXCLUDED.national_cup,
            champions_cup=EXCLUDED.champions_cup,
            challenge_cup=EXCLUDED.challenge_cup,
            conference_cup=EXCLUDED.conference_cup,
            trophies_total=EXCLUDED.trophies_total,
            register_date=EXCLUDED.register_date,
            register_season=EXCLUDED.register_season,
            active=EXCLUDED.active, season=EXCLUDED.season,
            updated_at=EXCLUDED.updated_at
        `;
        const params = [
          p.id, p.name, p.multiplier, p.country, p.continent, p.division,
          JSON.stringify(p.national_league || []),
          JSON.stringify(p.national_cup || []),
          JSON.stringify(p.champions_cup || []),
          JSON.stringify(p.challenge_cup || []),
          JSON.stringify(p.conference_cup || []),
          p.trophies_total || 0,
          p.register_date || null,
          p.register_season || null,
          JSON.stringify(p.active || { status: "Active", last_game: null }),
          p.season || 1,
          p.created_at || new Date().toISOString(),
          p.updated_at || new Date().toISOString()
        ];
        await client.query(q, params);
      }
      await client.query("COMMIT");
      return res.json({ status: "ok", inserted: payload.length });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("❌ ERROR /players", err);
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  } else {
    // Via Supabase API
    try {
      const { data, error } = await dbClient
        .from('players')
        .upsert(payload, { onConflict: 'id', returning: 'representation' });
      if (error) return res.status(400).json({ error });
      return res.json({ data });
    } catch (err) {
      console.error('❌ ERROR /players', err);
      return res.status(500).json({ error: err.message });
    }
  }
});

// ===========================
// endpoint /season_days
// ===========================
app.post('/season_days', requireApiKey, async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];
  if (connectionType === "Postgres (DATABASE_URL)") {
    try {
      const client = await dbClient.connect();
      await client.query("BEGIN");
      for (const s of payload) {
        await client.query(
          `INSERT INTO season_days (season, day, total_days, date_utc, updated_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (season, day) DO UPDATE SET
             total_days=EXCLUDED.total_days,
             date_utc=EXCLUDED.date_utc,
             updated_at=EXCLUDED.updated_at`,
          [s.season, s.day, s.total_days, s.date_utc, s.updated_at || new Date().toISOString()]
        );
      }
      await client.query("COMMIT");
      return res.json({ status: "ok", inserted: payload.length });
    } catch (err) {
      console.error("❌ ERROR /season_days", err);
      return res.status(500).json({ error: err.message });
    }
  } else {
    try {
      const { data, error } = await dbClient
        .from('season_days')
        .upsert(payload, { onConflict: ['season', 'day'], returning: 'representation' });
      if (error) return res.status(400).json({ error });
      return res.json({ data });
    } catch (err) {
      console.error('❌ ERROR /season_days', err);
      return res.status(500).json({ error: err.message });
    }
  }
});

// ===========================
// endpoint /logs
// ===========================
app.post('/logs', requireApiKey, async (req, res) => {
  if (connectionType === "Postgres (DATABASE_URL)") {
    console.log("📝 Log recebido:", req.body);
    return res.json({ status: "ok", logged: true });
  } else {
    try {
      const body = req.body;
      const logText = typeof body === 'string' ? body : JSON.stringify(body, null, 2);

      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      const filename = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;

      const { error } = await dbClient
        .storage
        .from('logs')
        .upload(filename, logText, {
          contentType: 'text/plain',
          upsert: true
        });

      if (error) throw error;

      return res.json({ status: 'ok', file: filename });
    } catch (err) {
      console.error('❌ ERROR /logs', err);
      return res.status(500).json({ error: err.message });
    }
  }
});

// ===========================
// root
// ===========================
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send(`PB backend ok (${connectionType})`));
app.listen(port, () => console.log(`🚀 PB backend listening on ${port} | Conexão: ${connectionType}`));
