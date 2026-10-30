(function(root){
    'use strict';
    const modes=typeof module!=='undefined' && module.exports ? require('./result_modes.js') : root.ResultModes;
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/\bdr\.\s*/gi,'').replace(/[^a-z0-9]+/gi,' ').trim().toLowerCase();
    function suggestMode(code,count,freshCode) {
        const candidates=modes.forCount(count);
        if(!candidates.length)return '';
        if(candidates.some(m=>m.code===code))return code;
        if(candidates.some(m=>m.code===freshCode))return freshCode;
        return (candidates.find(m=>m.kind===modes.get(code)?.kind) || candidates[0]).code;
    }
    function prepare(event, fresh, passNumbers) {
        if (!fresh?.title || !Array.isArray(fresh.participants)) throw new Error('Die ClubCloud-Teilnehmerdaten sind unvollständig.');
        const count=fresh.participants.length;
        const code=suggestMode(event.snapshot.selectedModeCode || 'T15',count,fresh.selectedModeCode);
        if(!code)throw new Error('Für diese Teilnehmerzahl ist noch kein Turniermodus verfügbar.');
        const variants = name => {
            const parts=String(name || '').split(',');
            return [normalize(name), ...(parts.length===2 ? [normalize(`${parts[1]} ${parts[0]}`)] : [])];
        };
        const index=new Map();
        for(const row of passNumbers)for(const key of variants(row.name)) {
            if(!key || !row.passNo)continue;
            const values=index.get(key) || new Set();values.add(String(row.passNo));index.set(key,values);
        }
        const seeds=new Set();
        const participants=fresh.participants.map((p,i)=>{
            const seed=Number(p.number || i+1);
            if(!Number.isInteger(seed) || seed<1 || seed>count || seeds.has(seed) || !String(p.name || '').trim())throw new Error('Die geladene Setzliste ist unvollständig oder enthält doppelte Plätze.');
            seeds.add(seed);
            const old=event.snapshot.participants.filter(previous=>normalize(previous.name)===normalize(p.name) && normalize(previous.club)===normalize(p.club));
            const matches=new Set(variants(p.name).flatMap(key=>[...(index.get(key) || [])]));
            const passNo=String(p.passNo || (old.length===1 ? old[0].passNo || '' : '') || (matches?.size===1 ? [...matches][0] : ''));
            return {...p,number:String(seed),seed,passNo};
        }).sort((a,b)=>a.seed-b.seed);
        return {...event.snapshot,...fresh,sourceUrl:event.source_url,eventId:event.source_event_id,
            date:fresh.date || event.event_date,startTime:fresh.startTime || event.snapshot.startTime || '',
            selectedModeCode:code,playingTargetPoints:event.snapshot.playingTargetPoints,playingTargetInnings:event.snapshot.playingTargetInnings,participants};
    }
    if(typeof module!=='undefined' && module.exports)module.exports={prepare,suggestMode};else root.T15ClubCloudReload={prepare,suggestMode};
})(typeof globalThis!=='undefined' ? globalThis : this);
