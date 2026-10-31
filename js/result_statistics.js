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
    const api={bestIndividualAverage};
    if(typeof module!=='undefined' && module.exports)module.exports=api;else root.ResultStatistics=api;
})(typeof globalThis!=='undefined'?globalThis:this);
