const {chromium}=require('/Users/philippjuede/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),assert=require('assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1280,height:800}});let device={event_id:'test',assignment:{key:'R1',title:'Testturnier',roundLabel:'Hauptrunde',label:'Partie 1',snapshot:{playingTargetPoints:100,playingTargetInnings:20,discipline:'Freie Partie',participants:[{seed:1,name:'Spieler Eins'},{seed:2,name:'Spieler Zwei'}]},seed1:1,seed2:2},paused:false};let results={};const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{
const u=new URL(route.request().url());
if(u.hostname!=='display.test')return route.fulfill({body:''});
if(u.pathname==='/js/auth.js')return route.fulfill({contentType:'text/javascript',body:'async function requireAdmin(){return true}'});
if(u.pathname==='/js/supabase.js')return route.fulfill({contentType:'text/javascript',body:`window.supabaseClient={rpc:async(name,args)=>({data:await window.fixture(name,args)})};`});
const file=process.cwd()+u.pathname;if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
return route.fulfill({contentType:u.pathname.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(file)});
});
await page.exposeFunction('fixture',(name)=>name==='tournament_operation'?device:{results});
await page.goto('http://display.test/turnier_tisch.html?tisch=tb01');
await page.waitForFunction(()=>document.getElementById('waiting').hidden);
assert.equal(await page.locator('#player1Name').textContent(),'Spieler Eins');assert.equal(await page.locator('#score1').textContent(),'0');assert.equal(await page.locator('button').count(),0);
await page.screenshot({path:'/tmp/tournament-display.png'});
results={R1:{score1:88,score2:76,innings1:10,innings2:10,high1:22,high2:18}};device.paused=true;
await page.waitForFunction(()=>document.getElementById('score1').textContent==='88');assert.match(await page.locator('#table-status').textContent(),/PAUSIERT/);assert.equal(await page.locator('#avg1').textContent(),'8,800');
device={event_id:null,assignment:null};await page.waitForFunction(()=>!document.getElementById('waiting').hidden);assert.match(await page.locator('#message').textContent(),/Warte auf Turnierstart/);
assert.deepEqual(errors,[]);await browser.close();console.log('PASS: copied display, names, scores, averages, pause, waiting, no app controls or browser errors');
})();
