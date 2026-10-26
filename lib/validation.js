class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function text(value, name, max = 20000, min = 1) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
        throw new HttpError(400, `${name} must contain ${min}–${max} characters`);
    }
    return value.trim();
}
function id(value, name = 'ID') {
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new HttpError(400, `Invalid ${name}`);
    return Number(value);
}
function integer(value, fallback, max = Number.MAX_SAFE_INTEGER, min = 0) {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new HttpError(400, 'Invalid pagination value');
    return Number(value);
}
function page(query, max = 100) { return { limit: integer(query.limit, 30, max, 1), offset: integer(query.offset, 0, 1000000) }; }
function email(value) {
    const result = text(value, 'Email', 255).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400, 'Enter a valid email address');
    return result;
}
function password(value) {
    if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value) > 72) throw new HttpError(400, 'Password must be at least 8 characters and at most 72 bytes');
    return value;
}
module.exports = { HttpError, text, id, integer, page, email, password };
