const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const mysql = require('mysql2');
for (const name of ['DB_HOST', 'DB_USER', 'DB_DATABASE']) {
    if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (process.env.DB_PASSWORD === undefined) throw new Error('Missing required environment variable: DB_PASSWORD');
module.exports = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: Number(process.env.DB_PORT || 3306),
    connectionLimit: 10,
    charset: 'utf8mb4',
}).promise();
