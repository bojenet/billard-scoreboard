const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('js/turnier_ergebnisse.js','utf8');
const ResultModes=require('../js/result_modes.js');
const helpers=source.slice(source.indexOf('    function absentSeeds()'),source.indexOf('    function renderMatches()'));
const handler=source.slice(source.indexOf("        $('absentParticipants').onchange="),source.indexOf("        $('modeForm').onsubmit="));
async function test({selected=[3],code='T16b',reset=false,approveRemoval=true,approveReset=true,error=null}={}) {
 const nodes={},calls=[],confirms=[],messages=[];let loads=0;
 const $=id=>nodes[id]??=(id==='absentParticipants'?{querySelectorAll:()=>selected.map(value=>({value:String(value)}))}:{});
 $('remainingMode').value=code;
 const c={$,ResultModes,esc:String,busy:false,dirty:true,view:'B',selected:'B1',pendingReload:{},eventId:'test',event:{version:7,can_change_mode:true,status:'open',snapshot:{participants:Array.from({length:10},(_,i)=>({seed:i+1,name:'Spieler '+(i+1)}))}},canLeave:()=>true,name:seed=>'Spieler '+seed,confirm:text=>{confirms.push(text);return confirms.length===1?approveRemoval:approveReset},rpc:async(fn,args)=>{calls.push({fn,...args});if(error)throw new Error(error);if(reset&&!args.p_reset)throw new Error('RESET_REQUIRED')},load:async()=>{loads++},notice:text=>messages.push(text),failure:e=>messages.push(e.message)};
 vm.createContext(c);vm.runInContext(helpers+handler,c);
 c.renderRemovalModes();
 await $('removeParticipantsForm').onsubmit({preventDefault(){}});
 return{c,nodes,calls,confirms,messages,loads};
}
(async()=>{
 let r=await test();
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].fn,'remove_result_participants');assert.equal(r.calls[0].p_version,7);assert.deepEqual(Array.from(r.calls[0].p_seeds),[3]);assert.equal(r.calls[0].p_mode,'T16b');assert.equal(r.calls[0].p_reset,false);assert.equal(r.loads,1);assert.equal(r.c.dirty,false);assert.equal(r.c.view,'A');assert.equal(r.nodes.participantEditor.open,false);assert.equal(r.c.busy,false);
 r=await test({approveRemoval:false});assert.equal(r.calls.length,0);assert.equal(r.loads,0);assert.equal(r.c.dirty,true);
 r=await test({reset:true});assert.equal(r.calls.length,2);assert.equal(r.calls[1].p_reset,true);assert.match(r.confirms[1],/ALLE bisherigen Ergebnisse/);
 r=await test({reset:true,approveReset:false});assert.equal(r.calls.length,1);assert.equal(r.loads,0);assert.equal(r.c.dirty,true);assert.equal(r.c.busy,false);assert.equal(r.nodes.removeParticipantsBtn.disabled,false);
 r=await test({selected:[]});assert.equal(r.calls.length,0);assert.equal(r.nodes.removeParticipantsBtn.disabled,true);
 r=await test({selected:[1,2,3,4,5,6,7]});assert.equal(r.calls.length,0);assert.equal(r.nodes.removeParticipantsBtn.disabled,true);assert.match(r.nodes.remainingParticipants.textContent,/kein Modus/);
 r=await test({selected:[1,2,3],code:'T10'});assert.equal(r.calls[0].p_mode,'T10');assert.equal(r.calls[0].p_seeds.length,3);
 r=await test({error:'VERSION_CONFLICT'});assert.equal(r.loads,0);assert.equal(r.c.dirty,true);assert.equal(r.c.busy,false);assert.deepEqual(r.messages,['VERSION_CONFLICT']);
 const visibility=source.split('\n').find(line=>line.includes("$('participantEditor').hidden="));
 for(const [event,hidden] of [[{can_change_mode:true,can_manage:false,status:'open'},false],[{can_change_mode:false,status:'open'},true],[{can_change_mode:true,status:'completed'},true],[{can_change_mode:true,status:'open',archived_ranking:{}},true]]) {
  const node={};vm.runInNewContext(visibility,{$:()=>node,event});assert.equal(node.hidden,hidden);
 }
 console.log('PASS: invited editor UI, compatible modes, multi-removal, confirmation, reset/cancel, unsupported counts, stale edit, dirty and busy recovery');
})().catch(error=>{console.error(error);process.exitCode=1});
