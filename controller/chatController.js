const db = require('../dbConfig');
const { HttpError, id, text, integer, page } = require('../lib/validation');
const messageFields = `m.id,m.conversation_id,m.user_id,m.body,m.created_at,m.attachment_name,m.attachment_mime,u.username`;
async function access(req, res, next) {
    const conversationId = id(req.params.id, 'conversation ID');
    const [rows] = await db.execute(`SELECT c.* FROM conversations c WHERE c.id=? AND (c.kind='room' OR EXISTS
        (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=c.id AND cm.user_id=?))`, [conversationId, req.user.userid]);
    if (!rows.length) throw new HttpError(404, 'Conversation not found');
    req.conversation = rows[0]; next();
}
async function list(req, res) {
    const { limit, offset } = page(req.query);
    const search = req.query.search === undefined ? '' : text(req.query.search, 'Search', 255, 0);
    const [rows] = await db.execute(`SELECT c.id,c.kind,c.name,c.created_at,COALESCE(own.muted,0) AS muted,
        peer.userid AS peer_id,peer.username,
        CASE WHEN EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id=peer.userid AND s.expires_at>NOW() AND s.last_seen_at>DATE_SUB(NOW(),INTERVAL 60 SECOND))
        THEN COALESCE(p.availability,'Online') ELSE 'Offline' END AS status,
        (SELECT COALESCE(NULLIF(m.body,''),m.attachment_name) FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS preview,
        (SELECT m.created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS updated_at,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.user_id<>? AND m.id>COALESCE(own.last_read_id,0)) AS unread
        FROM conversations c LEFT JOIN conversation_members own ON own.conversation_id=c.id AND own.user_id=?
        LEFT JOIN conversation_members other ON other.conversation_id=c.id AND other.user_id<>? AND c.kind='direct'
        LEFT JOIN users peer ON peer.userid=other.user_id LEFT JOIN user_preferences p ON p.user_id=peer.userid
        WHERE (c.kind='room' OR own.user_id IS NOT NULL) AND (COALESCE(c.name,peer.username) LIKE ?) ${req.conversation ? 'AND c.id=?' : ''}
        ORDER BY COALESCE(updated_at,c.created_at) DESC,c.id DESC LIMIT ${limit + 1} OFFSET ${offset}`, [req.user.userid, req.user.userid, req.user.userid, `%${search}%`, ...(req.conversation ? [req.conversation.id] : [])]);
    if (req.conversation) return res.json(rows[0]);
    res.json({ conversations: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null });
}
async function create(req, res) {
    if (req.body?.kind === 'room') {
        const name = text(req.body.name, 'Community name', 255);
        const [result] = await db.execute("INSERT INTO conversations (kind,name,created_by) VALUES ('room',?,?)", [name, req.user.userid]);
        return res.status(201).json({ id: result.insertId });
    }
    const recipient = id(req.body?.userId, 'recipient');
    if (recipient === req.user.userid) throw new HttpError(400, 'Choose another member');
    const [users] = await db.execute('SELECT userid FROM users WHERE userid=?', [recipient]);
    if (!users.length) throw new HttpError(404, 'User not found');
    const key = [recipient, req.user.userid].sort((a,b) => a-b).join(':');
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [result] = await connection.execute("INSERT INTO conversations (kind,direct_key,created_by) VALUES ('direct',?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", [key, req.user.userid]);
        await connection.execute('INSERT IGNORE INTO conversation_members (conversation_id,user_id) VALUES (?,?),(?,?)', [result.insertId, req.user.userid, result.insertId, recipient]);
        await connection.commit(); res.status(201).json({ id: result.insertId });
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
}
async function history(req, res) {
    const limit = integer(req.query.limit, 50, 100, 1);
    const before = req.query.before === undefined ? null : id(req.query.before);
    const after = req.query.after === undefined ? null : integer(req.query.after, 0);
    if (before !== null && after !== null) throw new HttpError(400, 'Use before or after, not both');
    const args = [req.conversation.id];
    if (before !== null) args.push(before);
    if (after !== null) args.push(after);
    const [rows] = await db.execute(`SELECT ${messageFields} FROM messages m JOIN users u ON u.userid=m.user_id
        WHERE m.conversation_id=? ${before !== null ? 'AND m.id<?' : ''} ${after !== null ? 'AND m.id>?' : ''}
        ORDER BY m.id ${after !== null ? 'ASC' : 'DESC'} LIMIT ${limit + 1}`, args);
    const messages = rows.slice(0, limit);
    if (after === null) messages.reverse();
    res.json({ messages, hasMore: rows.length > limit, nextBefore: messages[0]?.id || null });
}
function attachment(value) {
    if (value === undefined || value === null) return null;
    const name = text(value.name, 'Filename', 255).replace(/[\x00-\x1f\x7f/\\]/g, '_');
    if (typeof value.data !== 'string' || value.data.length > 1398104 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data) || value.data.length > 1398104) throw new HttpError(400, 'Invalid attachment (maximum 1 MiB)');
    const data = Buffer.from(value.data, 'base64');
    if (!data.length || data.length > 1048576) throw new HttpError(400, 'Attachment must contain 1 byte–1 MiB');
    // Downloads always use attachment disposition and octet-stream, never executable inline content.
    return { name, data, mime: 'application/octet-stream' };
}
async function send(req, res) {
    const body = text(req.body?.text === undefined ? '' : req.body.text, 'Message', 10000, 0);
    const file = attachment(req.body?.attachment);
    if (!body && !file) throw new HttpError(400, 'Enter a message or choose a file');
    const [result] = await db.execute('INSERT INTO messages (conversation_id,user_id,body,attachment_name,attachment_mime,attachment_data) VALUES (?,?,?,?,?,?)', [req.conversation.id, req.user.userid, body, file?.name || null, file?.mime || null, file?.data || null]);
    const [rows] = await db.execute(`SELECT ${messageFields} FROM messages m JOIN users u ON u.userid=m.user_id WHERE m.id=?`, [result.insertId]);
    res.status(201).json(rows[0]);
}
async function download(req, res) {
    const [rows] = await db.execute('SELECT attachment_name,attachment_data FROM messages WHERE id=? AND conversation_id=?', [id(req.params.messageId), req.conversation.id]);
    if (!rows.length || !rows[0].attachment_data) throw new HttpError(404, 'Attachment not found');
    res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');
    res.attachment(rows[0].attachment_name).type('application/octet-stream').send(rows[0].attachment_data);
}
async function read(req, res) {
    const lastId = integer(req.body?.lastId, 0);
    const [[row]] = await db.execute('SELECT COALESCE(MAX(id),0) AS lastId FROM messages WHERE conversation_id=? AND id<=?', [req.conversation.id, lastId]);
    await db.execute('INSERT INTO conversation_members (conversation_id,user_id,last_read_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE last_read_id=GREATEST(last_read_id,VALUES(last_read_id))', [req.conversation.id, req.user.userid, row.lastId]);
    res.sendStatus(204);
}
async function readAll(req, res) {
    await db.execute(`INSERT INTO conversation_members (conversation_id,user_id,last_read_id)
        SELECT c.id,?,COALESCE((SELECT MAX(m.id) FROM messages m WHERE m.conversation_id=c.id),0) FROM conversations c
        WHERE c.kind='room' OR EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id=c.id AND cm.user_id=?)
        ON DUPLICATE KEY UPDATE last_read_id=GREATEST(last_read_id,VALUES(last_read_id))`, [req.user.userid, req.user.userid]);
    res.sendStatus(204);
}
async function preferences(req, res) {
    if (typeof req.body?.muted !== 'boolean') throw new HttpError(400, 'Muted must be true or false');
    await db.execute('INSERT INTO conversation_members (conversation_id,user_id,muted) VALUES (?,?,?) ON DUPLICATE KEY UPDATE muted=VALUES(muted)', [req.conversation.id, req.user.userid, req.body.muted]);
    res.json({ muted: req.body.muted });
}
module.exports = { access, list, create, history, send, download, read, readAll, preferences };
