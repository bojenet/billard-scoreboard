const assert=require('node:assert/strict');
const {bestIndividualAverage:bed}=require('../js/result_statistics.js');
const schedule=[{key:'A1',stage:'A',seed1:1,seed2:2,ready:true},{key:'A2',stage:'A',seed1:1,seed2:3,ready:true},{key:'A3',stage:'A',seed1:4,seed2:1,ready:true},{key:'F',stage:'final',seed1:1,seed2:2,ready:true}];
const results={A1:{score1:25,score2:20,innings1:10,innings2:10},A2:{score1:29,score2:30,innings1:2,innings2:2},A3:{score1:20,score2:20,innings1:5,innings2:5},F:{score1:30,score2:30,innings1:3,innings2:3,winner:2}};
assert.equal(bed(schedule,results,1,'A'),4); // win + draw eligible, 14.5 losing average ignored
assert.equal(bed(schedule,results,1,'all'),4); // drawn final lost by decision is excluded
assert.equal(bed(schedule,results,2,'final'),10);
assert.equal(bed(schedule,results,2,'A'),null); // only loss
assert.equal(bed(schedule,results,1,'groups'),4);
assert.equal(bed(schedule,{},1),null);
results.A3.innings2=0;assert.equal(bed(schedule,results,1,'A'),2.5);
results.A1={score1:0,score2:0,innings1:1,innings2:1};assert.equal(bed(schedule,results,1,'A'),0);
console.log('PASS: BED from wins/draws only, excludes losses and KO decision loss, per-group/final/overall scopes, absent and zero-innings guards, valid zero draw');
