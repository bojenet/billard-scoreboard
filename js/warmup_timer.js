// One shared table clock: the app controls it, anonymous Pi displays only read it.
window.WarmupTimer = (() => {
    function remaining(state, now = Date.now()) {
        if (!state) return 300;
        const base = Number(state.remaining_seconds ?? state.duration_seconds ?? 300);
        const started = Date.parse(state.started_at);
        const elapsed = state.running && Number.isFinite(started) ? Math.max(0, (now - started) / 1000) : 0;
        return Math.max(0, Math.min(Number(state.duration_seconds), Math.ceil(base - elapsed)));
    }
    function format(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`; }
    function ringMarkup() {
        return `<div class="warmup-ring"><svg viewBox="0 0 120 120" aria-hidden="true">${Array.from({length:5},(_,i)=>`<circle class="warmup-track" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="18 82" stroke-dashoffset="${-20*i}"></circle><circle class="warmup-segment" data-segment="${i}" cx="60" cy="60" r="52" pathLength="100" stroke-dasharray="18 82" stroke-dashoffset="${-20*i}"></circle>`).join('')}</svg><span class="warmup-digits" role="timer" aria-live="off">5:00</span></div>`;
    }
    function renderRing(root, state) {
        const seconds = remaining(state);
        root.querySelector('.warmup-digits').textContent = format(seconds);
        root.querySelector('.warmup-digits').setAttribute('aria-label',`Restzeit ${Math.floor(seconds/60)} Minuten ${seconds%60} Sekunden`);
        root.classList.toggle('warmup-warning', Boolean(state?.active) && seconds <= 60);
        root.querySelectorAll('[data-segment]').forEach(segment => {
            const i = Number(segment.dataset.segment), slice = Number(state?.duration_seconds || 300) / 5;
            segment.classList.toggle('elapsed', seconds <= (4-i)*slice);
        });
        return seconds;
    }
    function connect(client, onState, onError) {
        let table = '', state = null, channel = null, generation = 0, disposed = false, reading = false;
        const apply = row => { if (row?.table_id === table && (!state || row.revision >= state.revision)) { state=row;onState(row); } };
        async function refresh() {
            if (!table || disposed || reading) return;
            const capturedTable=table, capturedGeneration=generation;reading=true;
            try {
                const {data,error}=await client.from('table_warmup_timers').select('*').eq('table_id',capturedTable).single();
                if (capturedGeneration!==generation || disposed) return;
                if(error)throw error;apply(data);
            } catch(error) { if(capturedGeneration===generation&&!disposed)onError(error); }
            finally{reading=false;}
        }
        const poll=setInterval(refresh,3000);
        return {
            getState:()=>state,
            async setTable(next) {
                if(disposed||!['tisch1','tisch2'].includes(next)||next===table)return;
                generation++;table=next;state=null;
                if(channel)client.removeChannel(channel);
                const captured=generation;
                channel=client.channel(`warmup-${next}-${Math.random().toString(36).slice(2)}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'table_warmup_timers',filter:`table_id=eq.${next}`},payload=>{if(captured===generation&&!disposed)apply(payload.new);}).subscribe();
                // A previous table's read must not suppress the initial read of this one.
                reading=false;await refresh();
            },
            async action(action,duration) {
                if(disposed)return;
                const current=state, captured=generation;
                if(!current)throw new Error('Einspiel-Timer wird noch geladen.');
                const {data,error}=await client.rpc('control_table_warmup',{p_table:table,p_action:action,p_revision:current.revision,p_duration:duration??null});
                if(disposed||captured!==generation)return;
                if(error){await refresh();throw error;}apply(data);
            },
            destroy(){disposed=true;generation++;clearInterval(poll);if(channel)client.removeChannel(channel);}
        };
    }
    function mountControls(root, client) {
        root.innerHTML=`${ringMarkup()}<div class="warmup-controls"><h3>Einspielzeit</h3><div class="warmup-durations" role="group" aria-label="Einspielzeit auswählen"><button type="button" data-duration="300" aria-pressed="true">5 Min.</button><button type="button" data-duration="600" aria-pressed="false">10 Min.</button></div><div class="warmup-actions"><button type="button" data-toggle>Start</button><button type="button" data-reset aria-label="Einspielzeit zurücksetzen">Zurücksetzen</button></div><p class="warmup-status" aria-live="polite">Timer wird geladen …</p></div>`;
        let state=null,busy=false,loadError='',selectedTable='';
        function render(){
            const seconds=renderRing(root,state);
            root.querySelectorAll('[data-duration]').forEach(b=>{b.setAttribute('aria-pressed',Number(b.dataset.duration)===(state?.duration_seconds||300));b.disabled=busy||!state;});
            const toggle=root.querySelector('[data-toggle]');toggle.disabled=busy||!state;toggle.textContent=seconds===0?'Erneut starten':state?.running?'Pause':state?.active?'Fortsetzen':'Start';
            root.querySelector('[data-reset]').disabled=busy||!state;
            const status=loadError||(!state?'Timer wird geladen …':seconds===0&&state.active?'Einspielzeit beendet':state.running?(seconds<=60?'Letzte Minute':'Einspielzeit läuft'):state.active?'Einspielzeit pausiert':'Bereit zur Einspielzeit');
            const statusElement=root.querySelector('.warmup-status');if(statusElement.textContent!==status)statusElement.textContent=status;
        }
        const connection=connect(client,row=>{state=row;loadError='';render();},error=>{loadError=error.message||'Timer konnte nicht geladen werden.';render();});
        async function act(action,duration){if(busy)return;busy=true;loadError='';render();try{await connection.action(action,duration);}catch(error){loadError=error.message||'Timer konnte nicht gesteuert werden.';}finally{busy=false;render();}}
        root.querySelectorAll('[data-duration]').forEach(button=>button.onclick=()=>{
            const duration=Number(button.dataset.duration);if(duration===state?.duration_seconds)return;
            if(state?.active&&!confirm('Einspielzeit mit der neuen Dauer zurücksetzen?'))return;
            act('duration',duration);
        });
        root.querySelector('[data-toggle]').onclick=()=>act(state?.running&&remaining(state)>0?'pause':'start');
        root.querySelector('[data-reset]').onclick=()=>{if(state?.active&&!confirm('Einspielzeit zurücksetzen und auf dem Tischdisplay ausblenden?'))return;act('reset');};
        const ticker=setInterval(render,250);render();
        return {setTable(next){if(next===selectedTable)return;selectedTable=next;state=null;loadError='';render();return connection.setTable(next);},destroy(){clearInterval(ticker);connection.destroy();}};
    }
    function mountDisplay(root, client, table, onVisibility) {
        root.innerHTML=`<div class="warmup-display-label">Einspielzeit</div>${ringMarkup()}<p class="warmup-display-status" aria-live="polite"></p>`;
        let state=null;
        function render(){const seconds=renderRing(root,state);root.hidden=!state?.active;root.setAttribute('aria-hidden',String(!state?.active));const status=state?.active?(seconds===0?'Einspielzeit beendet':state.running?(seconds<=60?'Letzte Minute':''):'Pause'):'';const statusElement=root.querySelector('.warmup-display-status');if(statusElement.textContent!==status)statusElement.textContent=status;onVisibility?.(Boolean(state?.active));}
        const connection=connect(client,row=>{state=row;render();},error=>console.warn('Einspielzeit nicht aktualisiert:',error));
        const ticker=setInterval(render,250);connection.setTable(table);render();
        return {destroy(){clearInterval(ticker);connection.destroy();}};
    }
    return {remaining,format,ringMarkup,renderRing,mountControls,mountDisplay,connect};
})();
