const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync('js/turnier_tisch.js','utf8');
const adopt=source.slice(source.indexOf('    function adopt('),source.indexOf('    function render()'));
const render=source.slice(source.indexOf('    function render()'),source.indexOf('    function renderBoard()'));
const c=vm.createContext({structuredClone,Date,setTimeout:()=>1,clearTimeout:()=>{}});
vm.runInContext(`let device={event_id:'a',mode_version:1,assignment:{key:'R1'}},event={},endscreen=null,transitionTimer,readyAt,connected=true;const nextButton={},overlay={};function updateWarmup(){}const controls=[{},{}];const el=()=>({value:''});const text=()=>{};const document={querySelectorAll:()=>controls};let rendered;function renderBoard(){rendered=device.assignment?.key||'free';}${adopt}${render}
const completed={results:{R1:{score1:100,score2:80}}};adopt({event_id:'a',mode_version:1,assignment:{key:'R2'}},completed);render();`,c);
assert.equal(vm.runInContext('rendered',c),'R1');assert.equal(vm.runInContext('device.assignment.key',c),'R2');assert.equal(vm.runInContext('controls.every(b=>b.disabled)',c),true);
vm.runInContext("adopt({event_id:'a',mode_version:1,assignment:{key:'R2'}},completed);render();",c);assert.equal(vm.runInContext('rendered',c),'R1');
vm.runInContext('endscreen=null;render()',c);assert.equal(vm.runInContext('rendered',c),'R2');
vm.runInContext("adopt({event_id:null,mode_version:2,assignment:null},null,{results:{R2:{score1:100,score2:50}}});render()",c);assert.equal(vm.runInContext('rendered',c),'R2');
vm.runInContext('endscreen=null;render()',c);assert.equal(vm.runInContext('rendered',c),'free');
assert(!source.includes('20000'));console.log('PASS: completed result retained across polls, inputs locked, Weiter reveals latest assignment, final result retained before free play, no automatic expiry');
