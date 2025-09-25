// backend.js (CommonJS)

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Pool Postgres - usa DATABASE_URL do Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl may be required depending on host; Render usually manages this.
});

// ---------- Helpers ----------
function log(...args) { console.log(...args); }
function errlog(...args) { console.error(...args); }

function checkApiKey(req, res, next) {
  const key = req.headers["x-api-key"] || req.query["x-api-key"] || req.query.api_key;
  const expected = process.env.BACKEND_API_KEY || "";
  if (!expected) {
    // se não estiver definido, permitimos (útil em dev) mas logamos
    log("⚠️ BACKEND_API_KEY não definido no servidor — aceitando sem chave (dev mode).");
    return next();
  }
  if (key === expected) return next();
  return res.status(401).json({ status: "error", message: "Invalid API key" });
}

function parseMaybeJson(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed;
    } catch (e) {
      // não JSON — devolve string original
      return value;
    }
  }
  return value;
}

// ---------- Routes ----------

// Health
app.get("/", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// GET /players/:id  -> retorna o jogador (formato compatível com userscript)
app.get("/players/:id", checkApiKey, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query("SELECT * FROM players WHERE id = $1 LIMIT 1", [id]);
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ status: "not_found", message: `Player ${id} not found` });
    }

    // Normaliza campos para o formato que o userscript espera
    const player = {
      id: row.id,
      name: row.name,
      multiplier: row.multiplier,
      country: row.country,
      continent: row.continent,
      division: row.division,
      national_league: parseMaybeJson(row.national_league),
      national_cup: parseMaybeJson(row.national_cup),
      champions_cup: parseMaybeJson(row.champions_cup),
      challenge_cup: parseMaybeJson(row.challenge_cup),
      conference_cup: parseMaybeJson(row.conference_cup),
      trophies_total: row.trophies_total,
      register_date: row.register_date,
      register_season: row.register_season,
      active: { status: row.active_status || (row.active && row.active.status) || "Active", last_game: null },
      season: row.season,
      created_at: row.created_at,
      updated_at: row.updated_at
    };

    return res.json(player);
  } catch (err) {
    errlog("Erro GET /players/:id", err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /players  -> upsert lista de players
app.post("/players", checkApiKey, async (req, res) => {
  const data = Array.isArray(req.body) ? req.body : [req.body];
  if (!data.length) return res.status(400).json({ status: "error", message: "No player data provided" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let upserted = 0;

    for (const p of data) {
      // Guarda arrays como JSON (strings) na BD
      const nl = JSON.stringify(p.national_league || []);
      const nc = JSON.stringify(p.national_cup || []);
      const ch = JSON.stringify(p.champions_cup || []);
      const chg = JSON.stringify(p.challenge_cup || []);
      const conf = JSON.stringify(p.conference_cup || []);

      const q = `
        INSERT INTO players (
          id, name, multiplier, country, continent, division,
          national_league, national_cup, champions_cup, challenge_cup, conference_cup,
          trophies_total, register_date, register_season, active_status, season,
          created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          multiplier = EXCLUDED.multiplier,
          country = EXCLUDED.country,
          continent = EXCLUDED.continent,
          division = EXCLUDED.division,
          national_league = EXCLUDED.national_league,
          national_cup = EXCLUDED.national_cup,
          champions_cup = EXCLUDED.champions_cup,
          challenge_cup = EXCLUDED.challenge_cup,
          conference_cup = EXCLUDED.conference_cup,
          trophies_total = EXCLUDED.trophies_total,
          register_date = EXCLUDED.register_date,
          register_season = EXCLUDED.register_season,
          active_status = EXCLUDED.active_status,
          season = EXCLUDED.season,
          updated_at = EXCLUDED.updated_at
      `;

      const params = [
        p.id, p.name, p.multiplier, p.country, p.continent, p.division,
        nl, nc, ch, chg, conf,
        p.trophies_total, p.register_date, p.register_season, (p.active && p.active.status) || "Active", p.season,
        p.created_at || new Date().toISOString(), p.updated_at || new Date().toISOString()
      ];

      await client.query(q, params);
      upserted++;
    }

    await client.query("COMMIT");
    log(`POST /players -> upserted ${upserted} players`);
    return res.json({ status: "ok", upserted });
  } catch (err) {
    await client.query("ROLLBACK");
    errlog("Erro POST /players", err);
    return res.status(500).json({ status: "error", message: err.message });
  } finally {
    client.release();
  }
});

// POST /season_days
// - se for enviado 1 item: vamos apagar a tabela e inserir apenas esse (singleton behaviour)
// - se forem vários: fazemos upsert por season (se existir coluna unique)
app.post("/season_days", checkApiKey, async (req, res) => {
  const data = Array.isArray(req.body) ? req.body : [req.body];
  if (!data.length) return res.status(400).json({ status: "error", message: "No season_days data provided" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (data.length === 1) {
      // Comportamento singleton: remove tudo e insere só o que veio
      const item = data[0];
      await client.query("DELETE FROM season_days");
      await client.query(
        `INSERT INTO season_days (season, day, total_days, date_utc, updated_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [item.season, item.day, item.total_days, item.date_utc, item.updated_at || new Date().toISOString()]
      );
      await client.query("COMMIT");
      log("POST /season_days -> singleton write");
      return res.json({ status: "ok", message: "season_days replaced (singleton)", inserted: 1 });
    }

    // Se vierem vários, tenta upsert por season (assume que há constraint unique(season) ou permite múltiplas linhas)
    let count = 0;
    for (const item of data) {
      // Tenta UPDATE por season; se não atualizar nada, INSERT
      const updateRes = await client.query(
        `UPDATE season_days SET day=$2, total_days=$3, date_utc=$4, updated_at=$5 WHERE season=$1 RETURNING *`,
        [item.season, item.day, item.total_days, item.date_utc, item.updated_at || new Date().toISOString()]
      );
      if (updateRes.rowCount === 0) {
        await client.query(
          `INSERT INTO season_days (season, day, total_days, date_utc, updated_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [item.season, item.day, item.total_days, item.date_utc, item.updated_at || new Date().toISOString()]
        );
      }
      count++;
    }

    await client.query("COMMIT");
    log(`POST /season_days -> upserted ${count} items`);
    return res.json({ status: "ok", upserted: count });
  } catch (err) {
    await client.query("ROLLBACK");
    errlog("Erro POST /season_days", err);
    return res.status(500).json({ status: "error", message: err.message });
  } finally {
    client.release();
  }
});

// Simple logs route for user script to post logs
app.post("/logs", checkApiKey, async (req, res) => {
  const body = req.body || {};
  log("LOG from userscript:", body.content || JSON.stringify(body).slice(0, 500));
  res.json({ status: "ok" });
});

// Start
app.listen(PORT, () => {
  log(`Backend rodando na porta ${PORT}`);
});
