require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { Pool } = require('pg');
const { parse } = require("pg-connection-string");

// ===========================
// Conexão Postgres (forçado DATABASE_URL)
// ===========================
if (!process.env.DATABASE_URL) {
  console.error("❌ Variável DATABASE_URL não definida!");
  process.exit(1);
}

const config = parse(process.env.DATABASE_URL);

const dbClient = new Pool({
  user: config.user,
  password: config.password,
  host: "db.muoieyuzedrfluplzpsr.supabase.co", // 👈 força IPv4
  port: config.port,
  database: config.database,
  ssl: { rejectUnauthorized: false }
});

const connectionType = "Postgres (DATABASE_URL, IPv4)";
const BACKEND_API_KEY = process.env.BACKEND_API_KEY || null;

const app = express();
app.set("trust proxy", 1); 
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
    const result = await dbClient.query("SELECT NOW()");
    return res.json({
      connection: connectionType,
      db_time: result.rows[0]
    });
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
});

// ===========================
// endpoint /season_days
// ===========================
app.post('/season_days', requireApiKey, async (req, res) => {
  const payload = Array.isArray(req.body) ? req.body : [req.body];
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
});

// ===========================
// endpoint /logs
// ===========================
app.post('/logs', requireApiKey, async (req, res) => {
  console.log("📝 Log recebido:", req.body);
  return res.json({ status: "ok", logged: true });
});

// ===========================
// root
// ===========================
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send(`PBB backend ok (${connectionType})`));
app.listen(port, () => console.log(`🚀 PBB backend listening on ${port} | Conexão: ${connectionType}`));
