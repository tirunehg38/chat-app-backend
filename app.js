const express = require('express');
const cors = require('cors');
require('./dbConfig');
const auth = require('./authMidlewier/authmidele');
const { HttpError } = require('./lib/validation');
const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000', exposedHeaders: ['X-Has-More'] }));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/user', require('./routes/userRouts'));
app.use('/api/all_question', auth, require('./routes/questionRoute'));
app.use('/api/answers', auth, require('./routes/answerRoute'));
app.use('/api/dashboard', auth, require('./routes/dashboardRoute'));
app.use('/api/chats', auth, require('./routes/chatRoute'));
app.use((req, res, next) => next(new HttpError(404, 'Endpoint not found')));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error instanceof HttpError ? error.status : 500;
    let message = status === 500 ? 'Unable to complete request. Please try again.' : error.message;
    if (error.code === 'ER_DUP_ENTRY') { status = 409; message = 'That username or email is already in use'; }
    if (error.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON body'; }
    if (error.type === 'entity.too.large') { status = 413; message = 'Request is too large. Attachments must be at most 1 MiB.'; }
    // Log only a category, never SQL parameters, credentials or message bodies.
    if (status === 500) console.error('Request failed:', error.code || error.name || 'Error');
    res.status(status).json({ msg: message, message });
});
if (require.main === module) {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be configured');
    app.listen(process.env.PORT || 5000, () => console.log('ChatQ API started'));
}
module.exports = app;
