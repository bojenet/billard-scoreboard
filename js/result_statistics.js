/* Display statistics only; tournament ranking remains PP, GD, HS. */
(function(root){
    'use strict';
    function bestIndividualAverage(schedule,results,seed,scope='all') {
        let best=null;
        for(const match of schedule) {
            if(!match.ready || (scope==='groups' ? match.stage==='final' : scope!=='all' && match.stage!==scope))continue;
            const r=results[match.key];if(!r)continue;
            const side=Number(match.seed1)===Number(seed)?1:Number(match.seed2)===Number(seed)?2:0;
            if(!side)continue;
            const score=Number(r['score'+side]),innings=Number(r['innings'+side]);
            const notLost=match.stage==='final' && [1,2].includes(Number(r.winner)) ? Number(r.winner)===side : score>=Number(r['score'+(3-side)]);
            if(!notLost || !Number.isFinite(score) || !Number.isFinite(innings) || innings<=0)continue;
            const average=score/innings;
            if(best===null || average>best)best=average;
        }
        return best;
    }
    function finalStandings(event) {
        const empty=()=>({points:0,balls:0,innings:0,high:0,played:0});
        const totals=new Map(event.snapshot.participants.map(p=>[p.seed,empty()]));
        const finalTotals=new Map(event.snapshot.participants.map(p=>[p.seed,empty()]));
        for(const match of event.schedule) {
            const r=event.results[match.key];if(!r || !match.ready)continue;
            for(const side of [1,2]) {
                const pp=match.stage==='final' ? (Number(r.winner)===side ? 2 : 0) : (r.score1===r.score2 ? 1 : ((r.score1>r.score2)===(side===1) ? 2 : 0));
                for(const map of (match.stage==='final' ? [totals,finalTotals] : [totals])) {
                    const t=map.get(match[`seed${side}`]);t.played++;t.points+=pp;t.balls+=r[`score${side}`];t.innings+=r[`innings${side}`];t.high=Math.max(t.high,r[`high${side}`]);
                }
            }
        }
        const ranks=[];
        for(const [key,first] of [['F',1],['P3',3],['P5',5],['P7',7],['P9',9]]) {
            const match=event.schedule.find(m=>m.key===key),r=event.results[key];
            if(r && match?.ready)ranks.push({rank:first,seed:match[`seed${r.winner}`]},{rank:first+1,seed:match[`seed${Number(r.winner)===1?2:1}`]});
        }
        if(event.snapshot.selectedModeCode==='T10' && event.schedule.find(m=>m.key==='HF1')?.ready) {
            ranks.push({rank:7,seed:event.standings.B[3].seed});
        }
        if(['T16','T16b'].includes(event.snapshot.selectedModeCode)) {
            const match=event.schedule.find(m=>m.key==='P8'),r=event.results.P8;
            if(r && match?.ready)ranks.push({rank:9,seed:match[Number(r.winner)===1?'seed2':'seed1']});
        }
        ranks.sort((a,b)=>a.rank-b.rank);
        return {ranks, totals, finalTotals};
    }
    const api={bestIndividualAverage,finalStandings};
    if(typeof module!=='undefined' && module.exports)module.exports=api;else root.ResultStatistics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
