const db = require('../dbConfig');
const { HttpError, text, id, page } = require('../lib/validation');
async function ensureQuestion(questionId) {
    const [rows] = await db.execute('SELECT id FROM questions WHERE id=?', [questionId]);
    if (!rows.length) throw new HttpError(404, 'Question not found');
}
async function createAnswer(req, res) {
    const questionId = id(req.body?.questionId, 'question ID'), answer = text(req.body?.answerText, 'Answer');
    await ensureQuestion(questionId);
    const [result] = await db.execute('INSERT INTO answers (question_id,answer_text,user_id,created_at) VALUES (?,?,?,NOW())', [questionId, answer, req.user.userid]);
    res.status(201).json({ msg: 'Answer created successfully', answerId: result.insertId });
}
async function getAnswersForQuestion(req, res) {
    const questionId = id(req.params.questionId, 'question ID'), { limit, offset } = page(req.query);
    await ensureQuestion(questionId);
    const [rows] = await db.execute(`SELECT a.id,a.answer_text,a.created_at,a.user_id,u.username FROM answers a
        JOIN users u ON u.userid=a.user_id WHERE a.question_id=? ORDER BY a.created_at,a.id LIMIT ${limit + 1} OFFSET ${offset}`, [questionId]);
    res.set('X-Has-More', String(rows.length > limit)).json(rows.slice(0, limit));
}
module.exports = { createAnswer, getAnswersForQuestion };
