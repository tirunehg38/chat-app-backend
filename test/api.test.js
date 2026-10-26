const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
process.env.JWT_SECRET = 'isolated-test-secret';
let handler;
const fakeDb = { execute: (...args) => handler(...args), query: (...args) => handler(...args) };
require.cache[require.resolve('../dbConfig')] = { exports: fakeDb };
const app = require('../app');
let server, base;
const authRow = { userid: 1, username: 'alice', Fname: 'Alice', Lname: 'Test' };
const token = jwt.sign({ userid: 1 }, process.env.JWT_SECRET, { jwtid: 'unit-session' });
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => { handler = async sql => sql.includes('FROM user_sessions s') ? [[authRow]] : [[]]; });
async function request(path, method = 'GET', body, credential = token) {
    return fetch(base + path, { method, headers: { ...(credential ? { Authorization: `Bearer ${credential}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function useDb(fn) { handler = (sql, args) => sql.includes('JOIN users u ON u.userid=s.user_id') ? Promise.resolve([[authRow]]) : fn(sql, args); }
test('all protected API groups reject missing and invalid credentials', async () => {
    for (const path of ['/user/check', '/user/profile', '/chats', '/all_question', '/answers/1', '/dashboard/home']) {
        assert.equal((await request(path, 'GET', undefined, null)).status, 401);
        assert.equal((await request(path, 'GET', undefined, 'broken')).status, 401);
    }
});
test('expired JWTs and revoked database sessions are rejected', async () => {
    const expired = jwt.sign({userid:1},process.env.JWT_SECRET,{jwtid:'expired',expiresIn:-1});
    assert.equal((await request('/user/check','GET',undefined,expired)).status,401);
    handler = async () => [[]];
    assert.equal((await request('/user/check')).status,401);
});
test('current user response uses database identity', async () => {
    assert.equal((await (await request('/user/check')).json()).username,'alice');
});
test('registration validates input and duplicate accounts', async () => {
    assert.equal((await request('/user/register','POST',{username:[]})).status,400);
    useDb(async () => [[{userid:1}]]);
    assert.equal((await request('/user/register','POST',{username:'alice',Fname:'A',Lname:'B',Email:'a@example.test',PASSWORD:'password123'})).status,409);
});
test('registration hashes the password and normalizes email', async () => {
    let saved;
    useDb(async (sql, args) => { if (sql.startsWith('INSERT')) { saved=args; return [{insertId:2}]; } return [[]]; });
    const response=await request('/user/register','POST',{username:' bob ',Fname:' B ',Lname:' C ',Email:'BOB@example.test',PASSWORD:'password123'});
    assert.equal(response.status,201); assert.equal(saved[3],'bob@example.test'); assert.equal(saved[0],'bob'); assert.ok(await bcrypt.compare('password123',saved[4]));
});
test('login rejects invalid credentials and does not leak database errors', async () => {
    assert.equal((await request('/user/login','POST',{Email:'a@example.test',PASSWORD:'password123'})).status,401);
    handler=async () => { const err=new Error('private SQL detail');err.code='TEST_FAILURE';throw err; };
    const response=await request('/user/login','POST',{Email:'a@example.test',PASSWORD:'password123'});
    assert.equal(response.status,500); assert.ok(!(await response.text()).includes('private SQL'));
});
test('login issues a session-bound JWT and logout removes that session', async () => {
    const hash=await bcrypt.hash('password123',4);const calls=[];
    useDb(async(sql,args)=>{calls.push([sql,args]);return sql.includes('SELECT userid,username,PASSWORD') ? [[{userid:1,username:'alice',PASSWORD:hash}]] : [{affectedRows:1}];});
    const response=await request('/user/login','POST',{Email:'alice@example.test',PASSWORD:'password123'});
    assert.equal(response.status,200); const data=await response.json();assert.equal(data.userid,1);assert.ok(jwt.verify(data.token,process.env.JWT_SECRET).jti);
    assert.equal((await request('/user/logout','POST')).status,204);assert.ok(calls.some(([sql,args])=>sql.startsWith('DELETE FROM user_sessions WHERE id=')&&args[0]==='unit-session'));
});
test('question creation normalizes text and uses authenticated ownership', async () => {
    let saved;
    useDb(async(sql,args)=>{saved=args;return [{insertId:4}];});
    const response=await request('/all_question','POST',{title:' title ',description:' details ',userId:999});
    assert.equal(response.status,201);assert.deepEqual(saved,['title','details',1]);assert.equal((await response.json()).questionId,4);
});
test('question input and pagination reject invalid values', async () => {
    for(const body of [{title:[],description:'test'},{title:'  ',description:'test'},{title:'x'.repeat(501),description:'test'}]) assert.equal((await request('/all_question','POST',body)).status,400);
    for(const query of ['limit=0','offset=-1','limit=2%3BDROP','filter=invalid']) assert.equal((await request(`/all_question?${query}`)).status,400);
});
test('question search and mine filter use parameterized SQL with accurate counts', async () => {
    let saved;
    useDb(async(sql,args)=>{saved={sql,args};return [[{id:2,title:'help',answer_count:2},{id:3,answer_count:0}]];});
    const response=await request('/all_question?search=help&filter=mine&limit=1');
    assert.equal(response.headers.get('x-has-more'),'true');assert.equal((await response.json())[0].answer_count,2);assert.deepEqual(saved.args,['%help%','%help%','%help%',1]);assert.ok(saved.sql.includes('COUNT(*) FROM answers'));
});
test('question detail and missing question statuses', async () => {
    useDb(async()=>[[{id:2,title:'question',answer_count:3}]]);
    assert.equal((await (await request('/all_question/2')).json()).answer_count,3);
    useDb(async()=>[[]]);assert.equal((await request('/all_question/2')).status,404);
});
test('answers require an existing question and reject blank content', async () => {
    assert.equal((await request('/answers','POST',{questionId:2,answerText:'answer'})).status,404);
    assert.equal((await request('/answers','POST',{questionId:2,answerText:'  '})).status,400);
    assert.equal((await request('/answers/0')).status,400);
});
test('answer creation and listing preserve the response contract', async () => {
    const calls=[];
    useDb(async(sql,args)=>{calls.push([sql,args]);if(sql.startsWith('INSERT'))return [{insertId:7}];if(sql.startsWith('SELECT id'))return [[{id:2}]];return [[{id:7,answer_text:'answer',username:'alice'}]];});
    assert.equal((await request('/answers','POST',{questionId:2,answerText:' answer '})).status,201);
    const rows=await (await request('/answers/2')).json();assert.equal(rows[0].answer_text,'answer');assert.deepEqual(calls.find(([sql])=>sql.startsWith('INSERT'))[1],[2,'answer',1]);
});
test('dashboard returns numerical counts and real question lists', async () => {
    useDb(async sql => sql.startsWith('SELECT (SELECT COUNT') ? [[{members:'3',questions:'2',answers:'4',communities:'1',activeUsers:'2'}]] : [[{id:2,title:'question',answer_count:4}]]);
    const response=await request('/dashboard/home');assert.equal(response.status,200);const data=await response.json();assert.equal(data.stats.answers,4);assert.equal(data.trendingQuestions[0].id,2);assert.ok(Array.isArray(data.recentQuestions));
});
test('conversation access blocks outsider reads, sends, preferences and downloads', async () => {
    for(const [path,method,body] of [['/chats/4/messages','GET'],['/chats/4/messages','POST',{text:'hello'}],['/chats/4/preferences','PATCH',{muted:true}],['/chats/4/messages/2/attachment','GET']]) assert.equal((await request(path,method,body)).status,404);
});
test('cannot start a conversation with self or an unknown user', async () => {
    assert.equal((await request('/chats','POST',{userId:1})).status,400);
    assert.equal((await request('/chats','POST',{userId:2})).status,404);
});
test('message history is chronological, bounded and paginated', async () => {
    useDb(async sql => sql.startsWith('SELECT c.*') ? [[{id:4}]] : [[{id:3},{id:2},{id:1}]]);
    const data=await (await request('/chats/4/messages?limit=2')).json();assert.deepEqual(data.messages.map(row=>row.id),[2,3]);assert.equal(data.hasMore,true);assert.equal(data.nextBefore,2);
    assert.equal((await request('/chats/4/messages?before=2&after=1')).status,400);
});
test('sending persists authenticated author and attachment and returns saved message', async () => {
    let values;
    useDb(async(sql,args)=>{
        if(sql.startsWith('SELECT c.*'))return [[{id:4}]];
        if(sql.startsWith('INSERT')){values=args;return [{insertId:9}];}
        return [[{id:9,body:'hello',user_id:1}]];
    });
    const response=await request('/chats/4/messages','POST',{text:' hello ',attachment:{name:'test.txt',data:Buffer.from('file').toString('base64')},userId:999});
    assert.equal(response.status,201);assert.equal(values[1],1);assert.equal(values[2],'hello');assert.equal(values[5].toString(),'file');
});
test('message and attachment validation reject malformed input', async () => {
    useDb(async()=>[[{id:4}]]);
    for(const body of [{text:'  '},{text:[]},{text:'x'.repeat(10001)},{attachment:{name:'a',data:'bad!'}},{attachment:{name:'a',data:''}}]) assert.equal((await request('/chats/4/messages','POST',body)).status,400);
    assert.equal((await request('/chats/4/preferences','PATCH',{muted:'yes'})).status,400);
});
test('read receipts never acknowledge IDs outside the conversation', async () => {
    let saved;
    useDb(async(sql,args)=>{if(sql.startsWith('SELECT c.*'))return [[{id:4}]];if(sql.includes('MAX(id)'))return [[{lastId:7}]];saved=args;return [{affectedRows:1}];});
    assert.equal((await request('/chats/4/read','POST',{lastId:9999})).status,204);assert.deepEqual(saved,[4,1,7]);
});
test('profile updates cannot change another user and settings validate availability', async () => {
    let saved;
    useDb(async(sql,args)=>{if(sql.startsWith('UPDATE users'))saved=args;return [[{...authRow,Email:'a@example.test'}]];});
    assert.equal((await request('/user/profile','PATCH',{username:'alice',Fname:'A',Lname:'B',Email:'a@example.test',userid:999})).status,200);assert.equal(saved.at(-1),1);
    assert.equal((await request('/user/settings','PATCH',{availability:'invisible'})).status,400);
});
test('unknown routes and malformed JSON return consistent safe errors', async () => {
    assert.equal((await request('/missing')).status,404);
    const response=await fetch(base+'/user/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});
    assert.equal(response.status,400);assert.equal((await response.json()).message,'Invalid JSON body');
});
