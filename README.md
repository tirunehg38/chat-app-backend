# ChatQ backend and setup

This project uses the existing Express/MySQL API and React/Axios client. No second database or realtime framework is required. The existing page layouts and `client/src/home.css` are retained.

## Start the system

1. Use Node.js 20 or newer and start your MySQL server. Ensure the database named by your existing `DB_DATABASE` configuration exists. Keep your existing data and database; do not recreate it.
2. In `backend`, keep your existing local environment configuration. For a new installation only, create a local `.env` using `.env.example` as a template. Configure these names privately:
   - `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`: your MySQL connection.
   - `DB_PORT`: optional, defaults to `3306`.
   - `JWT_SECRET`: a long random private value, required to sign sessions. Keep it stable between restarts. Never commit it.
   - `PORT`: optional, defaults to `5000`.
   - `CLIENT_ORIGIN`: exact frontend origin, defaults to `http://localhost:3000`. For example, using `127.0.0.1` instead of `localhost` requires the corresponding origin.
3. Run in `backend`:
   ```sh
   npm install
   npm run db:migrate
   npm start
   ```
   Migrations are repeatable, preserve existing users/questions/answers, and create missing session, presence-preference, conversation, membership and message tables. They also add query indexes and a real, empty General community. The database account needs permission to create tables and indexes during migration. Back up a production database before schema changes.
4. In a second terminal, run in `client`:
   ```sh
   npm install
   npm start
   ```
5. Open `http://localhost:3000`. **Restart an already-running backend after updating, and sign in again.** Old JWTs without a server-side session are intentionally rejected. Existing registered accounts and password hashes still work.
6. Register a second account in another browser or private window. Use the existing **+** button to find that member and start a private conversation. Use **Communities** to create a channel; General is available immediately. Send a message and refresh to confirm persistence.

For a different API host/port, set `REACT_APP_API_URL` in the client environment before `npm start` or `npm run build`, for example `https://api.example.com/api`. Match the backend `CLIENT_ORIGIN` to the frontend origin. Restart after changing environment configuration. Never put database credentials or JWT secrets in `REACT_APP_*` variables; client configuration is public.

## Connected features

- Registration normalizes email and stores bcrypt password hashes. Login returns the existing `token`/`username` fields plus `userid`. Server sessions last one day. Logout revokes the current session.
- Home and the right-hand panels load community counts, recent/popular/unanswered questions, and online members. Trending links open the selected question's answers.
- Q&A supports server-side search, popular/unanswered/own filters, pagination, question creation/details, answers and database-derived answer counts.
- Chat persists direct conversations and public community rooms, message history, unread/read-all state, and per-user mute preferences. A direct conversation is unique per user pair, including concurrent creation.
- The existing attachment buttons send files up to 1 MiB. Files are stored in MySQL and downloaded through authenticated, membership-checked endpoints as attachments. They are never served as inline executable HTML.
- Profile and Settings menus let members edit their profile and choose Online/Away. Public profiles do not expose email. The bell displays actual unread conversations. The three-dot control keeps the information panels working on Home, Q&A and Chat and retains its local visibility preference.

## API compatibility

All routes except registration and login require `Authorization: Bearer <token>`. Errors use both `msg` and `message` for the existing clients. Invalid input returns 400, unauthenticated sessions 401, inaccessible/missing resources 404, duplicate identities 409, and successful creates 201.

Existing routes are retained:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/user/register`, `POST /api/user/login` | Existing request field names: `username`, `Fname`, `Lname`, `Email`, `PASSWORD` |
| `GET /api/user/check` | Current database user |
| `GET/POST /api/all_question` | Array list / create `{title, description}` |
| `GET /api/all_question/:id` | Question detail including `answer_count` |
| `GET /api/answers/:questionId`, `POST /api/answers` | Array list / create `{questionId, answerText}` |
| `GET /api/dashboard/home` | Existing `stats` and `trendingQuestions`, plus recent/unanswered lists |

Question lists accept `search`, `filter=all|popular|unanswered|mine`, `limit` and `offset`. Question and answer list responses remain arrays and expose `X-Has-More` for pagination.

New routes:

| Endpoint | Behavior |
| --- | --- |
| `POST /api/user/logout`, `POST /api/user/heartbeat` | Revoke current session / refresh presence |
| `GET/PATCH /api/user/profile` | Read/edit own profile |
| `GET /api/user/profile/:id` | Public member profile |
| `PATCH /api/user/settings` | `{availability: "Online" | "Away"}` |
| `GET /api/user/users` | Discover members; `search`, `online=1`, `limit`, `offset` |
| `GET/POST /api/chats` | Paginated conversations / create with `{userId}` or `{kind:"room", name}` |
| `GET /api/chats/:id` | Authorized conversation metadata |
| `GET /api/chats/:id/messages` | `{messages, hasMore, nextBefore}`; `before` or `after` ID cursor, `limit` |
| `POST /api/chats/:id/messages` | `{text, attachment?: {name, data: base64}}` |
| `GET /api/chats/:id/messages/:messageId/attachment` | Authorized file download |
| `POST /api/chats/:id/read` | `{lastId}` acknowledges only messages from that conversation |
| `POST /api/chats/read-all` | Acknowledge accessible conversations |
| `PATCH /api/chats/:id/preferences` | `{muted: boolean}` |

## Verification

Backend:
```sh
npm test
npm run test:integration
```
`npm test` exercises HTTP routes with an isolated stubbed database. `test:integration` requires your configured MySQL database after migration, starts a separate local API on an available port, creates uniquely named temporary accounts/records, and removes its records afterward. It never prints credentials or tokens. Both commands need permission to open a local listening socket.

Client:
```sh
npm test -- --watchAll=false --runInBand
npm run lint
npm run build
```
CRA's older Jest runner is configured to resolve the installed React Router 7 distribution, with a test-only TextEncoder polyfill. This does not change production routing. Frontend tests cover the three-dot toggle on all three screens, failed-message draft retention, and conversation-menu behavior.

## Operational limits

Messages refresh every two seconds; shared dashboard data every ten seconds. Presence heartbeats run every 25 seconds for visible tabs and expire after 60 seconds. This project had no websocket infrastructure, so no Socket.IO service was added. Lists and history have pagination rather than silently dropping old data.

All community rooms are visible to signed-in members. Private rooms, moderation, message editing/deletion, Google OAuth, password recovery, and email delivery are not part of the implemented UI flow. The existing Google button stays disabled and password recovery continues to state it is unavailable. Attachments are limited to 1 MiB each and consume MySQL storage; no virus-scanning service is configured.

For internet deployment, use HTTPS, a suitable reverse proxy, persistent MySQL backups, and a process manager for the API. The existing Bearer/localStorage authentication approach is retained. Login/register throttling is per API process; a multi-instance deployment needs a shared gateway rate limit. A closed tab may appear online for up to 60 seconds.
# chat-app-backend
