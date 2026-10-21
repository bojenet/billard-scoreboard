const assert = require('node:assert/strict');
const {build} = require('../js/t15_csv_export.js');
const event = {title:'Test',event_date:'2026-10-21',snapshot:{startTime:'10:00',participants:Array.from({length:8},(_,i)=>({seed:i+1,name:`Spieler ${i+1}`,passNo:`00${i+1}`}))},results:{},schedule:[]};
for(const [group,seeds] of [['A',[1,4,5,8]],['B',[2,3,6,7]]]) {
    [[0,3],[1,2],[0,2],[3,1],[0,1],[2,3]].forEach(([a,b],i)=>event.schedule.push({key:group+(i+1),stage:group,label:'Partie '+(i+1),seed1:seeds[a],seed2:seeds[b],ready:true}));
}
for(const [key,a,b] of [['HF1',1,3],['HF2',2,4],['P7',8,7],['P5',5,6],['P3',3,4],['F',1,2]])event.schedule.push({key,stage:'final',label:key,seed1:a,seed2:b,ready:true});
for(const m of event.schedule)event.results[m.key]={score1:100,score2:87,innings1:12,innings2:11,high1:43,high2:8,winner:1};
const csv=build(event),bytes=Buffer.from(csv,'utf8'),lines=csv.trimEnd().split('\r\n');
assert.equal(bytes[0],71);assert.equal(csv.includes('\uFEFF'),false);
assert.equal(lines.length,18);for(const line of lines)assert.equal(line.split(';').length,13);
assert.equal(lines[0],'Gruppe A;1;1;001;008;100;87;12;11;43;8;21.10.2026;10:00');
assert.equal(lines[12].split(';')[0],'Halbfinale');assert.equal(lines[17].split(';')[0],'Finale');
// Archived pairings supplied by the access-checked RPC must remain authoritative.
const archive=structuredClone(event);archive.archived_ranking={};archive.schedule[12].seed2=5;
assert.equal(build(archive).trimEnd().split('\r\n')[12].split(';')[4],'005');
const partial=structuredClone(event);delete partial.results.A2;partial.results.A1.score2=0;partial.results.A1.high2=0;
const partialRows=build(partial).trimEnd().split('\r\n');assert.equal(partialRows.length,17);assert.equal(partialRows[1].split(';')[1],'3');assert.match(partialRows[0],/;100;0;12;11;43;0;/);
const missing=structuredClone(event);missing.snapshot.participants[0].passNo='';assert.throws(()=>build(missing),/Passnummer/);
const unresolved=structuredClone(event);unresolved.schedule[0].ready=false;assert.throws(()=>build(unresolved),/eindeutige Paarung/);
assert.throws(()=>build({...event,results:{}}),/keine gespeicherten/);
assert.throws(()=>build({...event,event_date:'2026-02-30'}),/datum/);
const blank=structuredClone(event);blank.event_date='';blank.snapshot.startTime='';assert.ok(build(blank).split('\r\n')[0].endsWith(';;'));
const quoted=structuredClone(event);quoted.snapshot.participants[0].passNo='ab;"cd';assert.ok(build(quoted).includes('"ab;""cd"'));
console.log('PASS: CSV data only without header, 13 columns, 18 games, UTF-8 without BOM, CRLF, pass numbers, archived pairings, partial/zero results, dates, quoting and missing-data validation');
