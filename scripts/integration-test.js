// Exercises the configured database with isolated temporary accounts; cleans only its own records.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const db = require('../dbConfig');
const app = require('../app');
(async () => {
    let server;
    const suffix = randomUUID().replaceAll('-', '');
    const accounts = Array.from({length:3}, (_,index) => ({ username:`test_${suffix}_${index}`, Email:`test_${suffix}_${index}@example.invalid`, Fname:'Integration', Lname:'Test', PASSWORD:`Test-${randomUUID()}` }));
    const users = [], conversations = [], questionIds = [];
    try {
        server = app.listen(0, '127.0.0.1');
        await new Promise((resolve, reject) => { server.once('listening',resolve); server.once('error',reject); });
        const base = `http://127.0.0.1:${server.address().port}/api`;
        const request = (path, method='GET', body, index=0) => fetch(base + path, {
            method, headers: { 'Content-Type':'application/json', ...(users[index]?.token ? { Authorization:`Bearer ${users[index].token}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        for (const account of accounts) {
            assert.equal((await request('/user/register','POST',account)).status,201);
            const response=await request('/user/login','POST',{Email:account.Email,PASSWORD:account.PASSWORD});
            assert.equal(response.status,200); users.push(await response.json());
        }
        assert.equal((await request('/user/check')).status,200);
        console.log('PASS registration, login and current-user check');
        const initial = await (await request('/dashboard/home')).json();
        const question = await (await request('/all_question','POST',{title:`Integration ${suffix}`,description:'Temporary test question'})).json();
        questionIds.push(question.questionId);
        assert.equal((await request(`/all_question/${question.questionId}`)).status,200);
        assert.equal((await request('/answers','POST',{questionId:question.questionId,answerText:'Temporary test answer'},1)).status,201);
        const answers=await (await request(`/answers/${question.questionId}`)).json(); assert.equal(answers.length,1);
        const listed=await (await request(`/all_question?filter=mine&search=${suffix}`)).json();assert.equal(listed.length,1);assert.equal(Number(listed[0].answer_count),1);
        const notMine=await (await request(`/all_question?filter=mine&search=${suffix}`,'GET',undefined,1)).json();assert.equal(notMine.length,0);
        const dashboard=await (await request('/dashboard/home')).json();assert.equal(dashboard.stats.questions,initial.stats.questions+1);assert.equal(dashboard.stats.answers,initial.stats.answers+1);
        console.log('PASS question create/details/search/mine, answer create/list, accurate dashboard counts');
        const response=await request('/chats','POST',{userId:users[1].userid});assert.equal(response.status,201);
        const chat=await response.json();conversations.push(chat.id);
        const same=await (await request('/chats','POST',{userId:users[0].userid},1)).json();assert.equal(same.id,chat.id);
        assert.equal((await request(`/chats/${chat.id}/messages`,'GET',undefined,2)).status,404);
        assert.equal((await request(`/chats/${chat.id}/messages`,'POST',{text:'forbidden'},2)).status,404);
        assert.equal((await request(`/chats/${chat.id}/read`,'POST',{lastId:999999},2)).status,404);
        const detail = await (await request(`/chats/${chat.id}`)).json(); assert.equal(detail.id,chat.id); assert.equal(detail.peer_id,users[1].userid);
        console.log('PASS direct conversation reuse, metadata and authorization');
        const sent=[];
        for(let n=0;n<3;n++) {
            const message=await request(`/chats/${chat.id}/messages`,'POST',{text:`temporary message ${n}`});assert.equal(message.status,201);sent.push(await message.json());
        }
        const history=await (await request(`/chats/${chat.id}/messages?limit=2`,'GET',undefined,1)).json();assert.equal(history.messages.length,2);assert.equal(history.hasMore,true);assert.equal(history.messages[1].id,sent[2].id);
        const older=await (await request(`/chats/${chat.id}/messages?before=${history.nextBefore}`,'GET',undefined,1)).json();assert.equal(older.messages[0].id,sent[0].id);
        const newer=await (await request(`/chats/${chat.id}/messages?after=${sent[1].id}`,'GET',undefined,1)).json();assert.equal(newer.messages[0].id,sent[2].id);
        let list=await (await request('/chats','GET',undefined,1)).json();assert.equal(Number(list.conversations.find(item=>item.id===chat.id).unread),3);
        assert.equal((await request(`/chats/${chat.id}/read`,'POST',{lastId:sent[2].id},1)).status,204);
        list=await (await request('/chats','GET',undefined,1)).json();assert.equal(Number(list.conversations.find(item=>item.id===chat.id).unread),0);
        assert.equal((await request(`/chats/${chat.id}/preferences`,'PATCH',{muted:true},1)).status,200);
        list=await (await request('/chats','GET',undefined,1)).json();assert.equal(Number(list.conversations.find(item=>item.id===chat.id).muted),1);
        assert.equal((await request('/chats/read-all','POST',{},1)).status,204);
        console.log('PASS persisted messages, history cursors, unread/read-all and mute settings');
        const attachment=await (await request(`/chats/${chat.id}/messages`,'POST',{text:'',attachment:{name:'temporary.txt',data:Buffer.from('attachment test').toString('base64')}})).json();
        const file=await request(`/chats/${chat.id}/messages/${attachment.id}/attachment`,'GET',undefined,1);assert.equal(file.status,200);assert.equal(await file.text(),'attachment test');assert.ok(file.headers.get('content-disposition').startsWith('attachment;'));
        assert.equal((await request(`/chats/${chat.id}/messages/${attachment.id}/attachment`,'GET',undefined,2)).status,404);
        const roomResponse=await request('/chats','POST',{kind:'room',name:`Temporary ${suffix}`});assert.equal(roomResponse.status,201);const room=await roomResponse.json();conversations.push(room.id);
        assert.equal((await request(`/chats/${room.id}/messages`,'POST',{text:'room message'},2)).status,201);
        const roomHistory=await (await request(`/chats/${room.id}/messages`)).json();assert.equal(roomHistory.messages.length,1);
        console.log('PASS protected attachments and shared community messages');
        assert.equal((await request('/user/heartbeat','POST')).status,204);
        const online=await (await request(`/user/users?online=1&search=${suffix}`)).json();assert.equal(online.users.length,3);
        const profile=await (await request('/user/profile')).json();assert.equal(profile.Email,accounts[0].Email);
        const publicProfile=await (await request(`/user/profile/${users[0].userid}`,'GET',undefined,1)).json();assert.equal(publicProfile.Email,undefined);
        assert.equal((await request('/user/profile','PATCH',{...profile,Fname:'Updated'})).status,200);
        assert.equal((await (await request('/user/profile')).json()).Fname,'Updated');
        assert.equal((await request('/user/settings','PATCH',{availability:'Away'})).status,200);
        const away=await (await request(`/user/users?online=1&search=${suffix}`)).json();assert.equal(away.users.length,2);
        assert.equal((await request('/user/logout','POST')).status,204);assert.equal((await request('/user/check')).status,401);
        console.log('PASS presence, profile privacy/edit, availability and token revocation');
        console.log('All live MySQL integration checks passed.');
    } catch(error) { console.error('Integration check failed:',error.code || error.message);process.exitCode=1; }
    finally {
        try {
            for(const conversationId of conversations) await db.execute('DELETE FROM conversations WHERE id=?',[conversationId]);
            for(const questionId of questionIds) await db.execute('DELETE FROM questions WHERE id=?',[questionId]);
            for(const account of accounts) await db.execute('DELETE FROM users WHERE Email=?',[account.Email]);
            console.log('Temporary integration records removed.');
        } finally { if(server) await new Promise(resolve=>server.close(resolve));await db.end(); }
    }
})();
