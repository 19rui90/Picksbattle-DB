app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ status: "ok", db_time: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});
