const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/turnier_ergebnisse.js','utf8');
const code=source.slice(source.indexOf("        $('modeForm').onsubmit="),source.indexOf("        document.querySelectorAll('[data-view]').forEach(b=>b.onclick"));
async function test(reset,approved=true){
 const form={},button={},selector={value:'T16b'},calls=[],messages=[];let loads=0;
 const c={busy:false,dirty:false,view:'B',eventId:'event',event:{version:3,snapshot:{selectedModeCode:'T16'}},$:id=>({modeForm:form,changeModeBtn:button,resultMode:selector})[id],canLeave:()=>true,confirm:()=>approved,rpc:async(fn,args)=>{calls.push({...args});if(reset&&!args.p_reset)throw new Error('RESET_REQUIRED');},load:async()=>{loads++},notice:m=>messages.push(m),failure:e=>{throw e}};
 vm.runInNewContext(code,c);await form.onsubmit({preventDefault(){}});return{calls,loads,c,button};
}
(async()=>{let r=await test(false);assert.equal(r.calls.length,1);assert.equal(r.loads,1);assert.equal(r.c.view,'A');assert.equal(r.button.disabled,false);r=await test(true);assert.equal(r.calls.length,2);assert.equal(r.calls[1].p_reset,true);assert.equal(r.loads,1);r=await test(true,false);assert.equal(r.calls.length,1);assert.equal(r.loads,0);assert.equal(r.c.busy,false);console.log('PASS: mode-choice submission, explicit reset confirmation, cancel without erasure and busy-state recovery');})().catch(e=>{console.error(e);process.exitCode=1});
const modes=require('../js/result_modes.js'),select={};
vm.runInNewContext(source.split('\n').find(line=>line.includes("$('resultMode').innerHTML=")),{$:()=>select,ResultModes:modes,event:{snapshot:{selectedModeCode:'T19',participants:Array(10)}},esc:String});
assert.match(select.innerHTML,/<option value="T16b" disabled>T16b · 3 Gruppen à 3 Spieler \(9 Teilnehmer erforderlich\)/);
assert.match(select.innerHTML,/<option value="T19" selected>T19 · 2 Gruppen à 5 Spieler<\/option>/);
assert(modes.list().every(m=>m.label));
console.log('PASS: all mode descriptions visible, T16b shown for ten-player event with count guard');
