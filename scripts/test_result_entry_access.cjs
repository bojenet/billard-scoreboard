const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context={URL,window:{location:{origin:'https://www.billard-studio.de'}},supabaseClient:{rpc:async()=>({data:{result_only:true,events:[]}})}};
vm.createContext(context);vm.runInContext(fs.readFileSync('js/result_entry_access.js','utf8'),context);
(async()=>{
 const assigned=await context.getResultEntryContext();
 for(const path of ['/index.html','/turnier_zentrale.html','/calendar.html','https://example.invalid/turnier_ergebnisse.html'])assert.equal(context.resultEntryPath(assigned,path),'/turnier_ergebnisse.html');
 assert.equal(context.resultEntryPath(assigned,'/turnier_ergebnisse.html?turnier=123&zugang=1'),'/turnier_ergebnisse.html?turnier=123&zugang=1');
 assert.equal(context.resultEntryPath({result_only:false},'/turnier_zentrale.html'),'/turnier_zentrale.html');
 const login=fs.readFileSync('login.html','utf8');
 vm.runInContext(login.slice(login.indexOf('        async function resolvePostLoginPath('),login.indexOf('        function setBusy(')),context);
 assert.equal(await context.resolvePostLoginPath({id:'helper'},'/turnier_zentrale.html'),'/turnier_ergebnisse.html');
 assert.equal(await context.resolvePostLoginPath({id:'helper'},'/turnier_ergebnisse.html?turnier=123&zugang=1'),'/turnier_ergebnisse.html?turnier=123&zugang=1');
 context.supabaseClient.rpc=async()=>({error:new Error('Unavailable')});await assert.rejects(()=>context.getResultEntryContext(),/Unavailable/);
 for(const path of ['login.html','index.html'])for(const script of fs.readFileSync(path,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
 console.log('PASS: dedicated result-only routing, preserved invitation/password links, normal users unchanged, failure handling, login/index syntax');
})().catch(e=>{console.error(e);process.exitCode=1});
