// Bound failed credential attempts without storing credentials or tokens.
const attempts = new Map();
module.exports = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const key = req.ip;
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 50) return res.status(429).json({ msg: 'Too many attempts. Try again later.', message: 'Too many attempts. Try again later.' });
    entry.count++; attempts.set(key, entry);
    next();
};
