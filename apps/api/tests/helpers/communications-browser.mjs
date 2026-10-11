import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

export async function verifyChatBrowser({app,service,owner,member}) {
  const root=fileURLToPath(new URL('../../../../',import.meta.url));
  const webRoot=path.join(root,'apps/web'),workerRequire=createRequire(path.join(root,'apps/site-worker/package.json')),webRequire=createRequire(path.join(webRoot,'package.json'));
  const {chromium}=workerRequire('playwright');
  const {createServer}=await import(pathToFileURL(webRequire.resolve('vite')).href);
  const api=await app.listen({port:0,host:'127.0.0.1'});
  const vite=await createServer({
    root:webRoot,optimizeDeps:{entries:['tests/fixtures/chat-entry.tsx']},configFile:path.join(webRoot,'vite.config.ts'),
    resolve:{alias:[
      {find:'../../api/client',replacement:path.join(webRoot,'tests/fixtures/chat-client.ts')},
      {find:'../../auth/useAuth',replacement:path.join(webRoot,'tests/fixtures/chat-auth.ts')},
    ]},
    server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':{target:api,ws:true,changeOrigin:true,rewrite:url=>url.replace('/api/v1/communications/conversations','/comms')}}},
    plugins:[{name:'isolated-chat-browser-entry',configureServer(server){
      server.middlewares.use(async(req,res,next)=>{
        if(!req.url?.startsWith('/app/chat'))return next();
        try{const html=await server.transformIndexHtml(req.url,'<!doctype html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Chat verification</title></head><body><div id="root"></div><script type="module" src="/tests/fixtures/chat-entry.tsx"></script></body></html>');
          res.setHeader('Content-Type','text/html');res.end(html);
        }catch(error){next(error);}
      });
    }}],
  });
  let browser;
  const artifacts=path.join(root,'artifacts/communications'),contexts=[],errors=[];
  try{
    await vite.listen();
    const origin='http://127.0.0.1:'+vite.httpServer.address().port;
    browser=await chromium.launch({headless:true});
    await mkdir(artifacts,{recursive:true});
    const firstContext=await browser.newContext({viewport:{width:1440,height:1000},extraHTTPHeaders:{authorization:'Bearer owner'}});
    const secondContext=await browser.newContext({viewport:{width:1280,height:900},extraHTTPHeaders:{authorization:'Bearer member'}});
    contexts.push(firstContext,secondContext);
    for(const context of contexts){
      await context.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'?route.continue():route.abort();});
      context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    }
    const first=await firstContext.newPage(),second=await secondContext.newPage();
    first.setDefaultTimeout(15000);second.setDefaultTimeout(15000);
    await first.goto(origin+'/app/chat');
    await first.getByRole('button',{name:'Create channel',exact:true}).click();
    const dialog=first.getByRole('dialog',{name:'Create a channel'});
    await dialog.getByLabel('Channel name').fill('Browser team');
    await dialog.getByLabel('Description',{exact:true}).fill('A shared team conversation');
    await dialog.getByRole('button',{name:'Create channel',exact:true}).click();
    await first.getByRole('heading',{name:'Browser team',exact:true}).waitFor();
    const cid=new URL(first.url()).pathname.split('/').at(-1);
    await service.addMember(owner,cid,{userId:member.userId,role:'MEMBER'});
    await second.goto(origin+'/app/chat/'+cid);
    await second.getByRole('heading',{name:'Browser team',exact:true}).waitFor();
    await second.goto(origin+'/app/chat');
    await first.getByRole('combobox',{name:'Message Browser team'}).fill('Hello from the first browser');
    await first.getByRole('combobox',{name:'Message Browser team'}).press('Enter');
    await second.getByRole('link',{name:/Browser team/}).getByLabel('1 unread messages').waitFor();
    await second.getByRole('link',{name:/Browser team/}).click();
    await second.locator('.chat-main,.chat-context-panel').getByText('Hello from the first browser',{exact:true}).waitFor();
    assert.equal(await second.locator('.chat-main,.chat-context-panel').getByText('Hello from the first browser',{exact:true}).count(),1);
    const rootMessage=second.getByRole('article').filter({hasText:'Hello from the first browser'});
    await rootMessage.hover();await rootMessage.getByRole('button',{name:'Add reaction',exact:true}).click();
    await rootMessage.getByRole('button',{name:'React 👍',exact:true}).click();
    await first.getByRole('button',{name:'👍, 1 reaction',exact:true}).waitFor();
    await rootMessage.getByRole('button',{name:'Reply in thread',exact:true}).click();
    await second.getByRole('combobox',{name:'Reply to thread'}).fill('A threaded reply');
    await second.getByRole('combobox',{name:'Reply to thread'}).press('Enter');
    await first.getByRole('button',{name:'1 reply',exact:true}).waitFor();
    await first.getByRole('button',{name:'1 reply',exact:true}).click();
    await first.locator('.chat-main,.chat-context-panel').getByText('A threaded reply',{exact:true}).waitFor();
    await first.getByRole('button',{name:'Close thread'}).click();await first.getByRole('region',{name:'Message thread',exact:true}).waitFor({state:'hidden'});
    await second.getByRole('button',{name:'Close thread'}).click();await second.getByRole('region',{name:'Message thread',exact:true}).waitFor({state:'hidden'});
    const own=first.getByRole('region',{name:'Channel messages',exact:true}).getByRole('article').filter({hasText:'Hello from the first browser'});
    await own.hover();await own.getByRole('button',{name:'Edit message'}).click();
    await first.getByRole('combobox',{name:'Message text'}).fill('Edited in the first browser');
    await first.getByRole('button',{name:'Save changes',exact:true}).click();
    await second.locator('.chat-main,.chat-context-panel').getByText('Edited in the first browser',{exact:true}).waitFor();
    await second.reload();await second.locator('.chat-main,.chat-context-panel').getByText('Edited in the first browser',{exact:true}).waitFor();
    await firstContext.setOffline(true);
    await second.getByRole('combobox',{name:'Message Browser team'}).fill('Sent while the other browser was offline');
    await second.getByRole('combobox',{name:'Message Browser team'}).press('Enter');
    await second.locator('.chat-main,.chat-context-panel').getByText('Sent while the other browser was offline',{exact:true}).waitFor();
    await firstContext.setOffline(false);
    await first.locator('.chat-main,.chat-context-panel').getByText('Sent while the other browser was offline',{exact:true}).waitFor({timeout:30000});
    await first.screenshot({path:path.join(artifacts,'desktop.png')});
    // Use the same production components at laptop, tablet and touch-browser widths.
    for(const [width,height] of [[1024,768],[820,1180],[390,844],[390,430]]){
      await second.setViewportSize({width,height});
      await second.getByRole('combobox',{name:'Message Browser team'}).click();
      assert.ok(await second.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'No horizontal page overflow at '+width);
      const box=await second.getByRole('combobox',{name:'Message Browser team'}).boundingBox();
      assert.ok(box && box.y+box.height<=height,'Composer stays in the visible viewport at '+width+'x'+height);
    }
    await second.setViewportSize({width:390,height:844});
    await second.getByRole('button',{name:'1 reply',exact:true}).click();
    await second.locator('.chat-main,.chat-context-panel').getByText('A threaded reply',{exact:true}).waitFor();
    assert.equal(await second.getByRole('combobox',{name:'Message Browser team'}).isVisible(),false);
    assert.ok(await second.getByRole('combobox',{name:'Reply to thread'}).isVisible());
    await second.screenshot({path:path.join(artifacts,'mobile-thread.png')});
    await second.getByRole('button',{name:'Close thread'}).click();
    await second.addScriptTag({path:workerRequire.resolve('axe-core/axe.min.js')});
    const accessibility=await second.evaluate(async()=>window.axe.run(document.querySelector('.chat-workspace'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    assert.deepEqual(accessibility.violations.map(v=>({id:v.id,description:v.description,nodes:v.nodes.map(n=>n.target)})),[]);
    const edited=first.getByRole('region',{name:'Channel messages',exact:true}).getByRole('article').filter({hasText:'Edited in the first browser'});
    await edited.hover();await edited.getByRole('button',{name:'Delete message'}).click();
    await first.getByRole('dialog',{name:'Delete message'}).getByRole('button',{name:'Delete message',exact:true}).click();
    await second.getByText('This message was deleted.',{exact:true}).waitFor();
    await second.getByRole('button',{name:'1 reply',exact:true}).click();
    await second.locator('.chat-main,.chat-context-panel').getByText('A threaded reply',{exact:true}).waitFor();
    await service.removeMember(owner,cid,member.userId);
    await second.getByText('This conversation is no longer available to you.',{exact:true}).waitFor();
    assert.equal(await second.locator('.chat-main,.chat-context-panel').getByText('A threaded reply',{exact:true}).count(),0);
    const history=String((await service.create(owner,{type:'CHANNEL',name:'Browser history',memberUserIds:[]})).id);
    for(let n=0;n<75;n++)await service.post(owner,history,{body:'Historical message '+n});
    await first.goto(origin+'/app/chat/'+history);
    await first.locator('.chat-main,.chat-context-panel').getByText('Historical message 74',{exact:true}).waitFor();
    assert.equal(await first.getByRole('article').count(),50);
    await first.getByRole('button',{name:'Load older messages',exact:true}).click();
    await first.locator('.chat-main,.chat-context-panel').getByText('Historical message 0',{exact:true}).waitFor();
    assert.equal(await first.getByRole('article').count(),75);
    await first.setViewportSize({width:390,height:844});
    await first.goto(origin+'/app/chat/invalid-channel');
    await first.getByRole('heading',{name:'Conversation unavailable',exact:true}).waitFor();
    await first.getByRole('link',{name:'Back to channels',exact:true}).click();
    await first.getByRole('heading',{name:'Chat',exact:true}).waitFor();

    // Phase 3: new-message discovery, canonical reopening, live typing/read state and private groups.
    await first.setViewportSize({width:1440,height:1000});await second.setViewportSize({width:1280,height:900});
    await first.getByRole('button',{name:'New message',exact:true}).click();
    let compose=first.getByRole('dialog',{name:'New message',exact:true});
    await compose.getByLabel('Find a colleague').fill('Grace');
    await compose.getByRole('checkbox',{name:'Grace Hopper',exact:true}).check();
    await compose.getByRole('button',{name:'Start conversation',exact:true}).click();
    await first.getByRole('heading',{name:'Grace Hopper',exact:true}).waitFor();
    const directUrl=first.url();
    await second.goto(origin+'/app/chat');
    await second.getByRole('link',{name:/Ada Lovelace/}).click();
    await second.getByRole('heading',{name:'Ada Lovelace',exact:true}).waitFor();
    await first.getByRole('link',{name:/Grace Hopper/}).getByText('Online',{exact:true}).waitFor();
    const dmComposer=second.getByRole('combobox',{name:'Message Ada Lovelace',exact:true});
    await dmComposer.fill('A private unsent draft');
    await first.getByText('Grace Hopper is typing…',{exact:true}).waitFor();
    assert.equal(await first.getByText('A private unsent draft',{exact:true}).count(),0);
    await dmComposer.clear();
    await first.getByText('Grace Hopper is typing…',{exact:true}).waitFor({state:'hidden'});
    await dmComposer.fill('Direct browser message');await dmComposer.press('Enter');
    await first.getByRole('article').getByText('Direct browser message',{exact:true}).waitFor();
    await first.bringToFront();await first.getByRole('article').getByText('Direct browser message',{exact:true}).click();
    await second.getByText('Read by Ada Lovelace',{exact:true}).waitFor();
    await second.reload();await second.getByRole('article').getByText('Direct browser message',{exact:true}).waitFor();
    await first.getByRole('button',{name:'New message',exact:true}).click();
    compose=first.getByRole('dialog',{name:'New message',exact:true});
    await compose.getByLabel('Find a colleague').fill('Grace');
    await compose.getByRole('checkbox',{name:'Grace Hopper',exact:true}).check();
    await compose.getByRole('button',{name:'Start conversation',exact:true}).click();
    await compose.waitFor({state:'hidden'});assert.equal(first.url(),directUrl);
    await first.getByRole('button',{name:'New message',exact:true}).click();
    compose=first.getByRole('dialog',{name:'New message',exact:true});
    await compose.getByRole('checkbox',{name:'Grace Hopper',exact:true}).check();
    await compose.getByRole('checkbox',{name:'Lin Chen',exact:true}).check();
    await compose.getByLabel('Group name (optional)').fill('Budget reviewers');
    await compose.getByRole('button',{name:'Create group',exact:true}).click();
    await first.getByRole('heading',{name:'Budget reviewers',exact:true}).waitFor();
    await second.getByRole('link',{name:/Budget reviewers/}).click();
    await second.getByRole('combobox',{name:'Message Budget reviewers'}).fill('Private group browser message');
    await second.getByRole('combobox',{name:'Message Budget reviewers'}).press('Enter');
    await first.getByRole('article').getByText('Private group browser message',{exact:true}).waitFor();
    await first.screenshot({path:path.join(artifacts,'phase3-desktop.png')});

    // Phase 4: authenticated binary upload, safe thumbnails, search anchors, preferences and notifications.
    const sharp=(await import('sharp')).default;
    const image=await sharp({create:{width:640,height:480,channels:3,background:'#4f46e5'}}).png().toBuffer();
    await first.getByLabel('Attach files',{exact:true}).setInputFiles([{name:'team-plan.txt',mimeType:'text/plain',buffer:Buffer.from('Quarterly project plan')},{name:'team-image.png',mimeType:'image/png',buffer:image}]);
    await first.getByText('Ready to send',{exact:true}).first().waitFor();
    await first.getByRole('button',{name:'Send message',exact:true}).click();
    await second.getByRole('article').getByText('team-plan.txt',{exact:true}).waitFor();
    await second.getByRole('article').getByRole('img',{name:'team-image.png',exact:true}).waitFor();
    await second.getByRole('button',{name:'Preview team-image.png',exact:true}).click();
    await second.getByRole('dialog',{name:'team-image.png',exact:true}).getByRole('img').waitFor();
    await second.getByRole('button',{name:'Close dialog',exact:true}).click();
    await first.getByRole('button',{name:'Files',exact:true}).click();
    await first.getByRole('heading',{name:'Shared files',exact:true}).waitFor();
    await first.locator('.chat-files-panel').getByText('team-plan.txt',{exact:true}).waitFor();
    await first.screenshot({path:path.join(artifacts,'phase4-files-desktop.png')});
    await first.getByRole('button',{name:'Close files',exact:true}).click();
    await first.getByRole('button',{name:'Search messages',exact:true}).click();
    const search=first.getByRole('dialog',{name:'Search messages'});
    await search.getByLabel('Search text',{exact:true}).fill('Private group browser message');
    await search.getByRole('button',{name:'Search',exact:true}).click();
    await search.locator('.chat-search-results button').first().click();
    await first.locator('.chat-search-target').getByText('Private group browser message',{exact:true}).waitFor();
    await first.getByRole('button',{name:'Chat notification settings'}).click();
    const settings=first.getByRole('dialog',{name:'Chat notification settings'});
    await settings.getByLabel('Do Not Disturb',{exact:true}).check();
    await first.getByRole('button',{name:'Close dialog',exact:true}).click();
    await first.getByRole('button',{name:'Chat notification settings'}).click();
    assert.ok(await settings.getByLabel('Do Not Disturb',{exact:true}).isChecked());
    await settings.getByLabel('Do Not Disturb',{exact:true}).uncheck();
    await first.getByRole('button',{name:'Close dialog',exact:true}).click();
    await first.getByRole('button',{name:/^Notifications/}).click();
    await first.getByRole('dialog',{name:'Chat notifications'}).getByText('Private group browser message',{exact:false}).waitFor();
    await first.getByRole('button',{name:'Close dialog',exact:true}).click();
    await first.screenshot({path:path.join(artifacts,'phase4-chat-desktop.png')});

    await second.setViewportSize({width:390,height:844});
    await second.getByRole('button',{name:'Conversation details',exact:true}).click();
    await second.getByRole('heading',{name:'Conversation details',exact:true}).waitFor();
    assert.ok(await second.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    await second.screenshot({path:path.join(artifacts,'phase3-mobile-details.png')});
    await second.getByRole('button',{name:'Close conversation details',exact:true}).click();
    await first.getByRole('button',{name:'Conversation details',exact:true}).click();
    await first.getByRole('button',{name:'Remove Grace Hopper',exact:true}).click();
    await first.getByRole('dialog',{name:'Remove member'}).getByRole('button',{name:'Remove member',exact:true}).click();
    await second.getByText('This conversation is no longer available to you.',{exact:true}).waitFor();
    assert.equal(await second.getByRole('article').count(),0);
    await first.getByRole('button',{name:'Close conversation details',exact:true}).click();
    await first.goto(directUrl);
    await first.getByRole('heading',{name:'Grace Hopper',exact:true}).waitFor();
    await secondContext.close();
    await first.getByRole('link',{name:/Grace Hopper/}).getByText('Offline',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  }catch(error){
    console.error('Communications browser verification failed:',error);
    for(let n=0;n<contexts.length;n++)for(const page of contexts[n].pages())await page.screenshot({path:path.join(artifacts,'failure-'+n+'.png')}).catch(()=>{});
    throw error;
  }finally{await browser?.close();for(const socket of app.websocketServer.clients)socket.terminate();await vite.close();}
}
