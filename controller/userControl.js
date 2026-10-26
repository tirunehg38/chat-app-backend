const db = require('../dbConfig');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { HttpError, text, id, page, email, password } = require('../lib/validation');
const profileFields = 'u.userid,u.username,u.Fname,u.Lname,u.created_at';
async function register(req, res) {
    const body = req.body || {};
    const username = text(body.username, 'Username', 255);
    const first = text(body.Fname, 'First name', 255), last = text(body.Lname, 'Last name', 255);
    const address = email(body.Email), secret = password(body.PASSWORD);
    const [existing] = await db.execute('SELECT userid FROM users WHERE username=? OR Email=?', [username, address]);
    if (existing.length) throw new HttpError(409, 'Username or email is already registered');
    const hash = await bcrypt.hash(secret, 10);
    await db.execute('INSERT INTO users (username,Fname,Lname,Email,PASSWORD) VALUES (?,?,?,?,?)', [username, first, last, address, hash]);
    res.status(201).json({ message: 'User registered successfully' });
}
async function login(req, res) {
    const address = email(req.body?.Email);
    const secret = req.body?.PASSWORD;
    if (typeof secret !== 'string' || !secret || Buffer.byteLength(secret) > 72) throw new HttpError(400, 'Enter your password');
    const [rows] = await db.execute('SELECT userid,username,PASSWORD FROM users WHERE Email=?', [address]);
    if (!rows.length || !await bcrypt.compare(secret, rows[0].PASSWORD)) throw new HttpError(401, 'Invalid credentials');
    const user = rows[0], sessionId = randomUUID();
    const token = jwt.sign({ userid: user.userid, username: user.username }, process.env.JWT_SECRET, { algorithm: 'HS256', jwtid: sessionId, expiresIn: '1d' });
    await db.execute('DELETE FROM user_sessions WHERE expires_at<=NOW()');
    await db.execute('INSERT INTO user_sessions (id,user_id,expires_at) VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 DAY))', [sessionId, user.userid]);
    res.json({ msg: 'Login successful', message: 'Login successful', token, userid: user.userid, username: user.username });
}
async function check(req, res) { res.json({ msg: 'Session active', ...req.user }); }
async function logout(req, res) { await db.execute('DELETE FROM user_sessions WHERE id=?', [req.sessionId]); res.sendStatus(204); }
async function heartbeat(req, res) {
    await db.execute('UPDATE user_sessions SET last_seen_at=NOW() WHERE id=?', [req.sessionId]);
    res.sendStatus(204);
}
async function getProfile(req, res) {
    const userId = req.params.id ? id(req.params.id) : req.user.userid;
    const [rows] = await db.execute(`SELECT ${profileFields}${userId === req.user.userid ? ',u.Email' : ''},
        COALESCE(p.availability,'Online') AS availability FROM users u LEFT JOIN user_preferences p ON p.user_id=u.userid WHERE u.userid=?`, [userId]);
    if (!rows.length) throw new HttpError(404, 'User not found');
    res.json(rows[0]);
}
async function updateProfile(req, res) {
    const body = req.body || {};
    const username = text(body.username, 'Username', 255), first = text(body.Fname, 'First name', 255), last = text(body.Lname, 'Last name', 255);
    const address = email(body.Email);
    await db.execute('UPDATE users SET username=?,Fname=?,Lname=?,Email=? WHERE userid=?', [username, first, last, address, req.user.userid]);
    req.user = { ...req.user, username, Fname: first, Lname: last };
    return getProfile(req, res);
}
async function settings(req, res) {
    const availability = req.body?.availability;
    if (!['Online','Away'].includes(availability)) throw new HttpError(400, 'Choose Online or Away');
    await db.execute('INSERT INTO user_preferences (user_id,availability) VALUES (?,?) ON DUPLICATE KEY UPDATE availability=VALUES(availability)', [req.user.userid, availability]);
    res.json({ availability });
}
async function users(req, res) {
    const { limit, offset } = page(req.query);
    const search = req.query.search === undefined ? '' : text(req.query.search, 'Search', 255, 0);
    const online = req.query.online === '1';
    const [rows] = await db.execute(`SELECT ${profileFields},
        CASE WHEN EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id=u.userid AND s.expires_at>NOW() AND s.last_seen_at>DATE_SUB(NOW(),INTERVAL 60 SECOND))
        THEN COALESCE(p.availability,'Online') ELSE 'Offline' END AS status
        FROM users u LEFT JOIN user_preferences p ON p.user_id=u.userid
        WHERE (u.username LIKE ? OR CONCAT(u.Fname,' ',u.Lname) LIKE ?)
        ${online ? "AND COALESCE(p.availability,'Online')='Online' AND EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id=u.userid AND s.expires_at>NOW() AND s.last_seen_at>DATE_SUB(NOW(),INTERVAL 60 SECOND))" : ''}
        ORDER BY u.username,u.userid LIMIT ${limit + 1} OFFSET ${offset}`, [`%${search}%`, `%${search}%`]);
    res.json({ users: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null });
}
module.exports = { register, login, check, logout, heartbeat, getProfile, updateProfile, settings, users };
