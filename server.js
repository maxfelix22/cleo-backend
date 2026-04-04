const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.json({ status: 'online', service: 'Cleo Backend', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const cleoRoutes = require('./new_items');
app.use('/', cleoRoutes);

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Cleo Backend rodando na porta ' + PORT);
  console.log('Square env: ' + (process.env.SQUARE_ACCESS_TOKEN ? 'OK' : 'FALTANDO TOKEN'));
});
