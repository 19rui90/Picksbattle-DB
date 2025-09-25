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
    const data = req.body[0]; // vem como array de 1
    if (!data) return res.status(400).json({ error: "sem dados" });

    // mantém apenas 1 linha → apaga as anteriores
    await db("season_days").del();
    await db("season_days").insert(data);

    res.json({ success: true, updated: data });
  } catch (err) {
    console.error("Erro em /season_days:", err);
    res.status(500).json({ error: "db error" });
  }
});


// Rota para players
app.post("/players", async (req, res) => {
    try {
        const data = req.body;
        let insertedCount = 0;

        for (const p of data) {
            const { rows } = await pool.query("SELECT * FROM players WHERE id = $1", [p.id]);
            const current = rows[0];

            const precisaAtualizar = !current || JSON.stringify(current) !== JSON.stringify({
                id: p.id,
                name: p.name,
                multiplier: p.multiplier,
                country: p.country,
                continent: p.continent,
                division: p.division,
                national_league: JSON.stringify(p.national_league),
                national_cup: JSON.stringify(p.national_cup),
                champions_cup: JSON.stringify(p.champions_cup),
                challenge_cup: JSON.stringify(p.challenge_cup),
                conference_cup: JSON.stringify(p.conference_cup),
                trophies_total: p.trophies_total,
                register_date: p.register_date,
                register_season: p.register_season,
                active_status: p.active.status,
                season: p.season,
                updated_at: p.updated_at
            });

            if (precisaAtualizar) {
                await pool.query(
                    `INSERT INTO players 
                    (id, name, multiplier, country, continent, division, national_league, national_cup, champions_cup, challenge_cup, conference_cup, trophies_total, register_date, register_season, active_status, season, created_at, updated_at)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                    ON CONFLICT (id) DO UPDATE 
                    SET name = EXCLUDED.name, multiplier = EXCLUDED.multiplier, country = EXCLUDED.country,
                        continent = EXCLUDED.continent, division = EXCLUDED.division,
                        national_league = EXCLUDED.national_league, national_cup = EXCLUDED.national_cup,
                        champions_cup = EXCLUDED.champions_cup, challenge_cup = EXCLUDED.challenge_cup,
                        conference_cup = EXCLUDED.conference_cup, trophies_total = EXCLUDED.trophies_total,
                        register_date = EXCLUDED.register_date, register_season = EXCLUDED.register_season,
                        active_status = EXCLUDED.active_status, season = EXCLUDED.season,
                        updated_at = EXCLUDED.updated_at`,
                    [
                        p.id, p.name, p.multiplier, p.country, p.continent, p.division,
                        JSON.stringify(p.national_league), JSON.stringify(p.national_cup),
                        JSON.stringify(p.champions_cup), JSON.stringify(p.challenge_cup),
                        JSON.stringify(p.conference_cup), p.trophies_total, p.register_date,
                        p.register_season, p.active.status, p.season, p.created_at, p.updated_at
                    ]
                );
                insertedCount++;
            }
        }

        res.json({ status: "ok", inserted: insertedCount });
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
