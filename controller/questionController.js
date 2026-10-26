const db = require('../dbConfig');
const { HttpError, text, id, page } = require('../lib/validation');
const fields = `q.id,q.title,q.description,q.created_at,q.user_id,u.username,
    (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) AS answer_count`;
async function createQuestion(req, res) {
    const title = text(req.body?.title, 'Title', 500), description = text(req.body?.description, 'Description');
    const [result] = await db.execute('INSERT INTO questions (title,description,user_id,created_at) VALUES (?,?,?,NOW())', [title, description, req.user.userid]);
    res.status(201).json({ msg: 'Question created successfully', questionId: result.insertId });
}
async function getAllQuestions(req, res) {
    const { limit, offset } = page(req.query);
    const search = req.query.search === undefined ? '' : text(req.query.search, 'Search', 255, 0);
    const filter = req.query.filter || 'all';
    if (!['all','popular','unanswered','mine'].includes(filter)) throw new HttpError(400, 'Invalid question filter');
    const conditions = ['(q.title LIKE ? OR q.description LIKE ? OR u.username LIKE ?)'];
    const args = Array(3).fill(`%${search}%`);
    if (filter === 'mine') { conditions.push('q.user_id=?'); args.push(req.user.userid); }
    if (filter === 'unanswered') conditions.push('NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id=q.id)');
    const [rows] = await db.execute(`SELECT ${fields} FROM questions q JOIN users u ON u.userid=q.user_id
        WHERE ${conditions.join(' AND ')} ORDER BY ${filter === 'popular' ? 'answer_count DESC,' : ''}q.created_at DESC,q.id DESC LIMIT ${limit + 1} OFFSET ${offset}`, args);
    res.set('X-Has-More', String(rows.length > limit)).json(rows.slice(0, limit));
}
async function getQuestionById(req, res) {
    const [rows] = await db.execute(`SELECT ${fields} FROM questions q JOIN users u ON u.userid=q.user_id WHERE q.id=?`, [id(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'Question not found');
    res.json(rows[0]);
}
module.exports = { createQuestion, getAllQuestions, getQuestionById };
