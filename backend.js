// backend.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { Pool } from "pg"; // Postgres. Se usares MySQL, trocas por mysql2
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3000;

// ===========================
// Configurações
// ===========================
app.use(cors()); // permite chamadas do Tampermonkey
app.use(bodyParser.json());

// ===========================
// Conexão à base de dados
// ===========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL // Render fornece esta variável
});

// ===========================
// Conexão à Supabase Storage
// ===========================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===========================
// Rotas
// ===========================

// Rota para season_days
app.post("/season_days", async (req, res) => {
  try {
    const data = req.body; // assume que é um array com objetos
    for (const item of data) {
      await pool.query(
        `INSERT INTO season_days (season, day, total_days, date_utc, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (season) DO UPDATE SET
           day = EXCLUDED.day,
           total_days = EXCLUDED.total_days,
           date_utc = EXCLUDED.date_utc,
           updated_at = EXCLUDED.updated_at`,
        [item.season, item.day, item.total_days, item.date_utc, item.updated_at]
      );
    }
    res.json({ status: "ok", inserted: data.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Rota para players
app.post("/players", async (req, res) => {
  try {
    const data = req.body;
    for (const p of data) {
      await pool.query(
        `INSERT INTO players (id, name, multiplier, country, continent, division, national_league, national_cup,
                              champions_cup, challenge_cup, conference_cup, trophies_total, register_date,
                              register_season, active_status, season, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
           updated_at = EXCLUDED.updated_at`,
        [
          p.id, p.name, p.multiplier, p.country, p.continent, p.division,
          JSON.stringify(p.national_league), JSON.stringify(p.national_cup),
          JSON.stringify(p.champions_cup), JSON.stringify(p.challenge_cup),
          JSON.stringify(p.conference_cup), p.trophies_total,
          p.register_date, p.register_season, p.active.status,
          p.season, p.created_at, p.updated_at
        ]
      );
    }
    res.json({ status: "ok", inserted: data.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ===========================
// Nova rota: logs
// ===========================
app.post("/logs", async (req, res) => {
  try {
    const data = req.body; // assume { content: "texto do log" }
    const logText = typeof data === "object" && data.content ? data.content : JSON.stringify(data);

    const now = new Date();
    const pad = n => n.toString().padStart(2, "0");
    const filename = `logs/${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.txt`;

    const { error } = await supabase.storage
      .from('logs') // nome do bucket na Supabase
      .upload(filename, logText, { contentType: 'text/plain' });

    if (error) throw error;

    res.json({ status: "ok", file: filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ===========================
// Start do servidor
// ===========================
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
