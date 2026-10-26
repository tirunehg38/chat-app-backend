const jwt = require('jsonwebtoken');
const db = require('../dbConfig');
async function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ msg: 'Sign in to continue', message: 'Sign in to continue' });
    let data;
    try { data = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
    catch { return res.status(401).json({ msg: 'Session expired. Please sign in again.', message: 'Session expired. Please sign in again.' }); }
    if (!data.jti || !Number.isSafeInteger(data.userid)) return res.status(401).json({ msg: 'Please sign in again', message: 'Please sign in again' });
    const [rows] = await db.execute(`SELECT u.userid,u.username,u.Fname,u.Lname FROM user_sessions s
        JOIN users u ON u.userid=s.user_id WHERE s.id=? AND s.user_id=? AND s.expires_at>NOW()`, [data.jti, data.userid]);
    if (!rows.length) return res.status(401).json({ msg: 'Session expired. Please sign in again.', message: 'Session expired. Please sign in again.' });
    req.user = rows[0]; req.sessionId = data.jti;
    next();
}
module.exports = authMiddleware;
