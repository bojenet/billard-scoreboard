// Run from the project root: node scripts/test_t15_calendar.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const invitation = { selectedModeCode:'T15',enableResultEntry:true, sourceUrl:'https://example.invalid/t15', playingTargetPoints:'25', playingTargetInnings:'40', participants:Array.from({length:8},(_,i)=>({number:String(i+1),name:'Spieler '+(i+1),passNo:'test-'+i})) };
let existing=null, stored=null, rpcCalls=0, modalError='';
const context={ResultModes:require('../js/result_modes.js'),currentUser:{id:'owner'},currentInvitationDraft:structuredClone(invitation),window:{location:{href:''}},getCalendarEventById:()=>({link:invitation.sourceUrl}),setModalMessage:(_id,text)=>{modalError=text;},showCalendarMessage:text=>{modalError=text;},supabaseClient:{from(table){const query={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:table==='result_events'?existing:{invitation}}),upsert:async data=>{stored=data;return {};}};return query;},rpc:async()=>{rpcCalls++;return {data:'event-id'};}}};
vm.createContext(context);vm.runInContext(fs.readFileSync('js/calendar_results.js','utf8'),context);
(async()=>{
 context.validateT15ResultInvitation(invitation);
 assert.throws(()=>context.validateT15ResultInvitation({...invitation,participants:invitation.participants.slice(0,7)}),/8/);
 assert.throws(()=>context.validateT15ResultInvitation({...invitation,playingTargetPoints:'Kommentar'}),/ganze Zahlen/);
 assert.throws(()=>context.validateT15ResultInvitation({...invitation,participants:invitation.participants.map(p=>({...p,number:'1'}))}),/Setzliste/);
 await context.persistInvitationForResults(invitation);assert.equal(stored.updated_by,'owner');assert.equal(stored.invitation.participants[0].passNo,'test-0');
 stored=null;await context.persistInvitationForResults({...invitation,selectedModeCode:'T20',enableResultEntry:false});assert.equal(stored.invitation.enableResultEntry,false);
 existing={id:'existing-event'};await context.openCalendarResultEntry('calendar-id');assert.equal(context.window.location.href,'turnier_ergebnisse.html?turnier=existing-event');assert.equal(rpcCalls,0);
 existing=null;await context.openCalendarResultEntry();assert.equal(rpcCalls,1);assert.equal(context.window.location.href,'turnier_ergebnisse.html?turnier=event-id');
 context.currentInvitationDraft={...invitation,selectedModeCode:'T20'};await context.openCalendarResultEntry();assert.match(modalError,/T15/);assert.equal(rpcCalls,1);
 for(const code of ['T3','T4','T5','T7','T8','T11','T12','T10','T16','T18','T19']) {
  const count=context.ResultModes.get(code).count;
  const candidate={...invitation,selectedModeCode:code,participants:Array.from({length:count},(_,i)=>({number:String(i+1),name:'Spieler '+(i+1),passNo:'test-'+i}))};
  context.validateT15ResultInvitation(candidate);
  assert.throws(()=>context.validateT15ResultInvitation({...candidate,participants:candidate.participants.slice(1)}),/Teilnehmer/);
  await context.persistInvitationForResults(candidate);assert.equal(stored.invitation.selectedModeCode,code);
  assert.equal(await context.ensureT15ResultEvent(candidate),'event-id');
 }
 for (const name of ['calendar.html','turnier_ergebnisse.html']) for (const script of fs.readFileSync(name,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
 console.log('PASS: all result-mode invitation validation/persistence/creation, frozen pass numbers, no changes for other modes, existing page reuse, result-page creation, unsupported mode message, inline script syntax');
})().catch(error=>{console.error(error);process.exitCode=1;});
