const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // necessário para Supabase
});

(async () => {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("✅ Conexão OK:", res.rows[0]);
  } catch (err) {
    console.error("❌ Erro na conexão:", err);
  } finally {
    await pool.end();
  }
})();
