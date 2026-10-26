const db = require('../dbConfig');
const questionQuery = `SELECT q.id,q.title,q.description,q.created_at,u.username,
    (SELECT COUNT(*) FROM answers a WHERE a.question_id=q.id) AS answer_count
    FROM questions q JOIN users u ON u.userid=q.user_id`;
async function getHomeDashboard(req, res) {
    const [[counts], [trendingQuestions], [recentQuestions], [unansweredQuestions]] = await Promise.all([
        db.execute(`SELECT (SELECT COUNT(*) FROM users) AS members,(SELECT COUNT(*) FROM questions) AS questions,
            (SELECT COUNT(*) FROM answers) AS answers,(SELECT COUNT(*) FROM conversations WHERE kind='room') AS communities,
            (SELECT COUNT(DISTINCT s.user_id) FROM user_sessions s LEFT JOIN user_preferences p ON p.user_id=s.user_id
             WHERE s.expires_at>NOW() AND s.last_seen_at>DATE_SUB(NOW(),INTERVAL 60 SECOND) AND COALESCE(p.availability,'Online')='Online') AS activeUsers`),
        db.execute(`${questionQuery} ORDER BY answer_count DESC,q.created_at DESC,q.id DESC LIMIT 5`),
        db.execute(`${questionQuery} ORDER BY q.created_at DESC,q.id DESC LIMIT 5`),
        db.execute(`${questionQuery} WHERE NOT EXISTS (SELECT 1 FROM answers a WHERE a.question_id=q.id) ORDER BY q.created_at DESC,q.id DESC LIMIT 5`),
    ]);
    res.json({ stats: Object.fromEntries(Object.entries(counts[0]).map(([key, value]) => [key, Number(value)])), trendingQuestions, recentQuestions, unansweredQuestions });
}
module.exports = { getHomeDashboard };
