import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';

// Production React calling components with fixture-only SDK/API. Real RTP is tested separately.
export async function verifyMeetingUi(){
 const root=fileURLToPath(new URL('../../../../',import.meta.url)),webRoot=path.join(root,'apps/web');
 const workerRequire=createRequire(path.join(root,'apps/site-worker/package.json')),webRequire=createRequire(path.join(webRoot,'package.json'));
 const {chromium}=workerRequire('playwright'),{createServer}=await import(pathToFileURL(webRequire.resolve('vite')).href);
 const artifacts=path.join(root,'artifacts/meetings');await mkdir(artifacts,{recursive:true});
 const vite=await createServer({root:webRoot,configFile:path.join(webRoot,'vite.config.ts'),optimizeDeps:{entries:['tests/fixtures/calls-ui-entry.tsx']},
 resolve:{alias:[
 {find:'livekit-client',replacement:path.join(webRoot,'tests/fixtures/calls-ui-sdk.ts')},
 {find:'./calls.api',replacement:path.join(webRoot,'tests/fixtures/calls-ui-api.ts')},
 {find:'../chat/chat.phase4.api',replacement:path.join(webRoot,'tests/fixtures/calls-ui-preferences.ts')},
 {find:'../../auth/useAuth',replacement:path.join(webRoot,'tests/fixtures/chat-auth.ts')},
 {find:'../../api/client',replacement:path.join(webRoot,'tests/fixtures/chat-client.ts')},
 ]},
 server:{host:'127.0.0.1',port:0,hmr:false},
 plugins:[{name:'isolated-native-calls-ui',configureServer(server){server.middlewares.use(async(request,response,next)=>{
 if(!request.url?.startsWith('/native-calls'))return next();
 try{const html=await server.transformIndexHtml(request.url,'<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KSOS calling interface verification</title></head><body><div id="root"></div><script type="module" src="/tests/fixtures/calls-ui-entry.tsx"></script></body></html>');response.setHeader('Content-Type','text/html');response.end(html);}catch(error){next(error);}
 });}}]});
 let browser,page;const errors=[];const evidence=[];
 try{
 await vite.listen();const origin='http://127.0.0.1:'+vite.httpServer.address().port;
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/native-calls');await page.getByRole('button',{name:'Start video call'}).click();
 await page.getByRole('button',{name:'Join call',exact:true}).waitFor();
 await page.addScriptTag({path:workerRequire.resolve('axe-core/axe.min.js')});
 const accessibility=async(label)=>{
 const results=await page.evaluate(async()=>window.axe.run(document.querySelector('.call-window')||document.querySelector('.call-incoming'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
 assert.deepEqual(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],label+' accessibility');evidence.push(label+' passed axe WCAG checks');
 };
 await accessibility('Pre-join desktop');await page.screenshot({path:path.join(artifacts,'native-prejoin-desktop.png')});
 await page.getByLabel('Enable camera preview').check();await page.getByLabel('Your camera preview').waitFor();
 await page.getByRole('button',{name:'Join call',exact:true}).click();await page.getByRole('button',{name:'Unmute',exact:true}).waitFor();
 await page.getByRole('button',{name:'Unmute',exact:true}).click();await page.getByRole('button',{name:'Mute',exact:true}).waitFor();
 await page.getByRole('article',{name:'Grace Hopper',exact:true}).waitFor();
 await page.screenshot({path:path.join(artifacts,'native-call-desktop.png')});await accessibility('Connected desktop');
 await page.getByRole('button',{name:'Share screen',exact:true}).click();await page.getByRole('button',{name:'Stop sharing',exact:true}).waitFor();
 await page.getByRole('button',{name:'Participants',exact:true}).click();await page.getByRole('heading',{name:'Participants',exact:true}).waitFor();
 await page.screenshot({path:path.join(artifacts,'native-share-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile has no horizontal overflow');
 await accessibility('Connected mobile');await page.screenshot({path:path.join(artifacts,'native-call-mobile.png')});
 await page.getByRole('button',{name:'Minimize call'}).click();await page.getByRole('button',{name:'Expand call'}).waitFor();
 await page.getByRole('button',{name:'Expand call'}).click();
 await page.evaluate(()=>window.callsFixture.end());await page.getByRole('heading',{name:'Ended by organiser'}).waitFor();
 await page.getByRole('button',{name:'Back to workspace'}).click();
 await page.evaluate(()=>window.callsFixture.invite());await page.getByRole('button',{name:'Decline',exact:true}).waitFor();
 await page.screenshot({path:path.join(artifacts,'native-incoming-mobile.png')});
 await page.getByRole('button',{name:'Decline',exact:true}).click();await page.getByRole('button',{name:'Decline',exact:true}).waitFor({state:'hidden'});
 await page.evaluate(()=>window.callsFixture.invite());await page.getByRole('button',{name:'Accept',exact:true}).click();
 await page.getByRole('button',{name:'Join call',exact:true}).waitFor();await accessibility('Pre-join mobile');
 await page.screenshot({path:path.join(artifacts,'native-prejoin-mobile.png')});
 evidence.push('Native UI start, explicit preview, join, mute, camera, screen share, participants, minimize, end, incoming decline and accept');
 assert.deepEqual(errors,[],'No browser runtime errors');
 await writeFile(path.join(artifacts,'native-ui-verification.json'),JSON.stringify({environment:'GitHub Chromium native React UI with mocked SDK/API',evidence,limitations:['This fixture proves UI behaviour and layout only. Separate real-media tests verify LiveKit transport.']},null,2));
 }catch(error){await page?.screenshot({path:path.join(artifacts,'native-ui-failure.png')}).catch(()=>{});throw error;}
 finally{await browser?.close();await vite.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await verifyMeetingUi();

