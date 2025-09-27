// backend.js (unificado, CommonJS)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(helmet());

// CORS - permite requests de qualquer origem (Tampermonkey)
app.use(cors({ origin: '*' }));

// Rate limit simples
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // max 60 requests por IP por minuto
});
app.use(limiter);

// PostgreSQL via Connection String
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // necessário no Render
  },
});

// Middleware de autenticação via BACKEND_API_KEY
app.use((req, res, next) => {
  const key = req.headers['authorization']?.split(' ')[1];
  if (!key || key !== process.env.BACKEND_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Endpoint de teste
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Endpoint para enviar logs
app.post('/logs', async (req, res) => {
  try {
    const log = req.body;
    console.log('Recebido log:', log);
    // TODO: adicionar persistência no banco ou Supabase se necessário
    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao enviar logs:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Endpoint para gerenciar jogadores
app.post('/player', async (req, res) => {
  try {
    const player = req.body;
    console.log('Recebido jogador:', player);

    // Exemplo de insert/update no Postgres
    const query = `
      INSERT INTO players(id, name, register_date)
      VALUES($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          register_date = EXCLUDED.register_date
      RETURNING *;
    `;
    const values = [player.id, player.name, player.register_date];
    const result = await pool.query(query, values);

    res.json({ success: true, player: result.rows[0] });
  } catch (err) {
    console.error('Erro ao inserir/verificar jogador:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Inicialização segura do servidor
(async () => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1'); // Testa conexão
    client.release();
    console.log('Conexão à DB OK');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Server rodando na porta ${PORT}`));
  } catch (err) {
    console.error('Erro ao conectar à DB:', err);
    process.exit(1); // encerra a instância se DB falhar
  }
})();
