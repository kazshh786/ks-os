import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

export async function verifyChatBrowser({app,service,owner,member}) {
  const root=fileURLToPath(new URL('../../../../',import.meta.url));
  const webRoot=path.join(root,'apps/web'),workerRequire=createRequire(path.join(root,'apps/site-worker/package.json')),webRequire=createRequire(path.join(webRoot,'package.json'));
  const {chromium}=await import(pathToFileURL(workerRequire.resolve('playwright')).href);
  const {createServer}=await import(pathToFileURL(webRequire.resolve('vite')).href);
  const api=await app.listen({port:0,host:'127.0.0.1'});
  const vite=await createServer({
    root:webRoot,configFile:path.join(webRoot,'vite.config.ts'),
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
  await vite.listen();
  const origin='http://127.0.0.1:'+vite.httpServer.address().port;
  const browser=await chromium.launch({headless:true});
  const artifacts=path.join(root,'artifacts/communications');await mkdir(artifacts,{recursive:true});
  const contexts=[],errors=[];
  try{
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
    await first.getByRole('combobox',{name:'Message Browser team'}).fill('Hello from the first browser');
    await first.getByRole('combobox',{name:'Message Browser team'}).press('Enter');
    await second.getByText('Hello from the first browser',{exact:true}).waitFor();
    assert.equal(await second.getByText('Hello from the first browser',{exact:true}).count(),1);
    const rootMessage=second.getByRole('article').filter({hasText:'Hello from the first browser'});
    await rootMessage.hover();await rootMessage.getByRole('button',{name:'Add reaction',exact:true}).click();
    await rootMessage.getByRole('button',{name:'React 👍',exact:true}).click();
    await first.getByRole('button',{name:'👍, 1 reaction',exact:true}).waitFor();
    await rootMessage.getByRole('button',{name:'Reply in thread',exact:true}).click();
    await second.getByRole('combobox',{name:'Reply to thread'}).fill('A threaded reply');
    await second.getByRole('combobox',{name:'Reply to thread'}).press('Enter');
    await first.getByRole('button',{name:'1 reply',exact:true}).waitFor();
    await first.getByRole('button',{name:'1 reply',exact:true}).click();
    await first.getByText('A threaded reply',{exact:true}).waitFor();
    await first.getByRole('button',{name:'Close thread'}).click();
    await second.getByRole('button',{name:'Close thread'}).click();
    const own=first.getByRole('article').filter({hasText:'Hello from the first browser'});
    await own.hover();await own.getByRole('button',{name:'Edit message'}).click();
    await first.getByRole('combobox',{name:'Message text'}).fill('Edited in the first browser');
    await first.getByRole('button',{name:'Save changes',exact:true}).click();
    await second.getByText('Edited in the first browser',{exact:true}).waitFor();
    await second.reload();await second.getByText('Edited in the first browser',{exact:true}).waitFor();
    await firstContext.setOffline(true);
    await second.getByRole('combobox',{name:'Message Browser team'}).fill('Sent while the other browser was offline');
    await second.getByRole('combobox',{name:'Message Browser team'}).press('Enter');
    await second.getByText('Sent while the other browser was offline',{exact:true}).waitFor();
    await firstContext.setOffline(false);
    await first.getByText('Sent while the other browser was offline',{exact:true}).waitFor({timeout:30000});
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
    await second.getByText('A threaded reply',{exact:true}).waitFor();
    assert.equal(await second.getByRole('combobox',{name:'Message Browser team'}).isVisible(),false);
    assert.ok(await second.getByRole('combobox',{name:'Reply to thread'}).isVisible());
    await second.screenshot({path:path.join(artifacts,'mobile-thread.png')});
    await second.getByRole('button',{name:'Close thread'}).click();
    await second.addScriptTag({path:workerRequire.resolve('axe-core/axe.min.js')});
    const accessibility=await second.evaluate(async()=>window.axe.run(document.querySelector('.chat-workspace'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    assert.deepEqual(accessibility.violations.map(v=>({id:v.id,description:v.description,nodes:v.nodes.map(n=>n.target)})),[]);
    const edited=first.getByRole('article').filter({hasText:'Edited in the first browser'});
    await edited.hover();await edited.getByRole('button',{name:'Delete message'}).click();
    await first.getByRole('dialog',{name:'Delete message'}).getByRole('button',{name:'Delete message',exact:true}).click();
    await second.getByText('This message was deleted.',{exact:true}).waitFor();
    await second.getByRole('button',{name:'1 reply',exact:true}).click();
    await second.getByText('A threaded reply',{exact:true}).waitFor();
    await service.removeMember(owner,cid,member.userId);
    await second.getByText('This channel is no longer available to you.',{exact:true}).waitFor();
    assert.equal(await second.getByText('A threaded reply',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  }catch(error){
    for(let n=0;n<contexts.length;n++)for(const page of contexts[n].pages())await page.screenshot({path:path.join(artifacts,'failure-'+n+'.png')}).catch(()=>{});
    throw error;
  }finally{await browser.close();await vite.close();}
}
