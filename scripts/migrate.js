const fs = require('node:fs');
const path = require('node:path');
const db = require('../dbConfig');
(async () => {
    const connection = await db.getConnection();
    try {
        const [[lock]] = await connection.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':chatq:migrations'), 30) AS acquired");
        if (Number(lock.acquired) !== 1) throw new Error('Another migration process is running');
        await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
        for (const name of fs.readdirSync(path.join(__dirname, '../migrations')).filter(name => name.endsWith('.sql')).sort()) {
            const [applied] = await connection.execute('SELECT name FROM schema_migrations WHERE name=?', [name]);
            if (applied.length) continue;
            for (const statement of fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8').split(';')) {
                if (statement.replace(/--[^\n]*/g, '').trim()) await connection.query(statement);
            }
            await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
            console.log(`Applied ${name}`);
        }
        for (const [table, name, columns] of [
            ['questions', 'idx_questions_created_id', 'created_at, id'],
            ['answers', 'idx_answers_question_id_id', 'question_id, id'],
        ]) {
            const [indexes] = await connection.execute('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?', [table, name]);
            if (!indexes.length) await connection.query(`CREATE INDEX \`${name}\` ON \`${table}\` (${columns})`);
        }
        console.log('Database is up to date.');
    } finally {
        await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':chatq:migrations'))");
        connection.release();
        await db.end();
    }
})().catch(error => { console.error(`Migration failed (${error.code || error.name}). Check database configuration and permissions.`); process.exitCode = 1; });
