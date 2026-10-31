const assert = require('node:assert/strict');
const {build} = require('../js/t15_csv_export.js');
const event = {title:'Test',event_date:'2026-10-21',snapshot:{startTime:'10:00',participants:Array.from({length:8},(_,i)=>({seed:i+1,name:`Spieler ${i+1}`,passNo:`00${i+1}`}))},results:{},capture_times:{},schedule:[]};
for(const [group,seeds] of [['A',[1,4,5,8]],['B',[2,3,6,7]]]) {
    [[0,3],[1,2],[0,2],[3,1],[0,1],[2,3]].forEach(([a,b],i)=>event.schedule.push({key:group+(i+1),stage:group,label:'Partie '+(i+1),seed1:seeds[a],seed2:seeds[b],ready:true}));
}
for(const [key,a,b] of [['HF1',1,3],['HF2',2,4],['P7',8,7],['P5',5,6],['P3',3,4],['F',1,2]])event.schedule.push({key,stage:'final',label:key,seed1:a,seed2:b,ready:true});
for(const m of event.schedule)event.results[m.key]={score1:100,score2:87,innings1:12,innings2:11,high1:43,high2:8,winner:1};
for(const m of event.schedule)event.capture_times[m.key]='2026-10-21T08:00:45Z';
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
const blank=structuredClone(event);blank.event_date='';blank.snapshot.startTime='';blank.capture_times={};assert.ok(build(blank).split('\r\n')[0].endsWith(';;'));
const quoted=structuredClone(event);quoted.snapshot.participants[0].passNo='ab;"cd';assert.ok(build(quoted).includes('"ab;""cd"'));
console.log('PASS: CSV data only without header, 13 columns, 18 games, UTF-8 without BOM, CRLF, pass numbers, archived pairings, partial/zero results, dates, quoting and missing-data validation');

const rr=structuredClone(event);rr.schedule=[{...rr.schedule[0],roundLabel:'Hauptrunde'}];rr.results={A1:rr.results.A1};assert.ok(build(rr).startsWith('Hauptrunde;1;1;'));console.log('PASS: round-robin CSV round label without header');

const t19=structuredClone(event);t19.snapshot.selectedModeCode='T19';
t19.snapshot.participants=Array.from({length:10},(_,i)=>({seed:i+1,name:'Spieler '+(i+1),passNo:String(i+1).padStart(3,'0')}));
t19.schedule=[{key:'P9',stage:'final',label:'Spiel um Platz 9',seed1:10,seed2:9,ready:true}];
t19.results={P9:{score1:100,score2:87,innings1:12,innings2:11,high1:43,high2:8,winner:1}};
assert.ok(build(t19).startsWith('Spiel um Platz 9;1;1;010;009;'));
console.log('PASS: T19 ninth-place CSV round label and ten-player pass numbers');

const t16=structuredClone(t19);t16.snapshot.selectedModeCode='T16';t16.snapshot.participants=t16.snapshot.participants.slice(0,9);
t16.schedule=[{key:'P8',stage:'final',label:'Spiel um Platz 8',seed1:7,seed2:9,ready:true}];t16.results={P8:t19.results.P9};
assert.ok(build(t16).startsWith('Spiel um Platz 8;1;1;007;009;'));console.log('PASS: T16 neu eighth-place CSV');

const t16b=structuredClone(t16);t16b.snapshot.selectedModeCode='T16b';t16b.schedule=[{key:'C1',stage:'C',roundLabel:'Gruppe C',seed1:3,seed2:7,ready:true}];t16b.results={C1:t16.results.P8};assert.ok(build(t16b).startsWith('Gruppe C;1;1;003;007;'));console.log('PASS: T16b group C export');

const timed=structuredClone(event);timed.snapshot.startTime='06:00';timed.capture_times.A1='2026-10-31T10:00:59Z';
assert.equal(build(timed).split('\r\n')[0].split(';')[12],'11:00');
timed.capture_times.A1='2026-07-01T09:00:00Z';assert.equal(build(timed).split('\r\n')[0].split(';')[12],'11:00');
delete timed.capture_times.A1;assert.equal(build(timed).split('\r\n')[0].split(';')[12],'');
timed.capture_times.A1='invalid';assert.throws(()=>build(timed),/Erfassungszeit/);
console.log('PASS: per-game capture time HH:MM in Europe/Berlin, summer/winter handling, no invitation-time fallback, unknown time blank');
