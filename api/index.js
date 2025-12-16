const express = require('express');
const { Pool } = require('pg');
const redis = require('redis');

const app = express();
app.use(express.json());

const PORT = 3000;

const PG_USER = process.env.PG_USER || 'app';
const PG_PASSWORD = process.env.PG_PASSWORD || 'app_pwd';
const PG_DB = process.env.PG_DB || 'appdb';

const writePool = new Pool({
  user: PG_USER,
  host: 'localhost',
  database: PG_DB,
  password: PG_PASSWORD,
  port: 5439,
});

const readPool = new Pool({
  user: PG_USER,
  host: 'localhost',
  database: PG_DB,
  password: PG_PASSWORD,
  port: 5433,
});

const redisClient = redis.createClient({
  socket: {
    host: 'localhost',
    port: 6379,
  }
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

(async () => {
    try {
        await redisClient.connect();
        console.log('Connected to Redis');
    } catch (e) {
        console.log('Failed to connect to Redis', e);
    }
})();

const getCache = async (key) => {
    if (!redisClient.isOpen) return null;
    try {
        return await redisClient.get(key);
    } catch (e) {
        console.error('Redis get error:', e);
        return null;
    }
};

const setCache = async (key, value, ttl = 60) => {
    if (!redisClient.isOpen) return;
    try {
        await redisClient.set(key, value, { EX: ttl });
    } catch (e) {
        console.error('Redis set error:', e);
    }
};

const delCache = async (key) => {
    if (!redisClient.isOpen) return;
    try {
        await redisClient.del(key);
    } catch (e) {
        console.error('Redis del error:', e);
    }
};

app.get('/products/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `product:${id}`;

    const cachedData = await getCache(cacheKey);
    if (cachedData) {
        console.log(`Cache HIT for ${cacheKey}`);
        return res.json(JSON.parse(cachedData));
    }

    console.log(`Cache MISS for ${cacheKey}`);

    try {
        const result = await readPool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const product = result.rows[0];

        await setCache(cacheKey, JSON.stringify(product), 60);

        res.json(product);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/products', async (req, res) => {
    const { name, price_cents } = req.body;
    try {
        const result = await writePool.query(
            'INSERT INTO products(name, price_cents) VALUES($1, $2) RETURNING *',
            [name, price_cents]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.put('/products/:id', async (req, res) => {
    const { id } = req.params;
    const { price_cents } = req.body;

    try {
        const result = await writePool.query(
            'UPDATE products SET price_cents = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [price_cents, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        const cacheKey = `product:${id}`;
        await delCache(cacheKey);
        console.log(`Invalidated cache for ${cacheKey}`);

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
