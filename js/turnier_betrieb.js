/* Independent tournament operation; no access to the existing matches or app. */
(async () => {
 'use strict';
 const ids=['tb01','tb02','tb03','tb04','mb01','mb02'];
 const message=document.getElementById('message');
 const kiosk=!!document.getElementById('kiosk');
 const table=new URLSearchParams(location.search).get('tisch');
 let busy=false;
 const rpc=async args=>{const {data,error}=await supabaseClient.rpc('tournament_operation',args);if(error)throw error;return data;};
 const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
 if(kiosk&&!ids.includes(table)){message.textContent='Ungültiger Tisch. Erlaubt: '+ids.join(', ');return;}
 if(!await requireAdmin())return;
 if(kiosk)document.getElementById('table').textContent=table.toUpperCase();
 let events=[];
 const selectEvent=document.getElementById("event");
 function showAssigned(){
  const event=events.find(e=>e.id===selectEvent.value);
  document.getElementById("assigned-tables").textContent=event?.tableIds?.length ? "Tische: "+event.tableIds.map(t=>t.toUpperCase()).join(", ") : "Tische zuerst in der Einladung festlegen und Turnierdaten aktualisieren.";
  document.getElementById("start").disabled=!event?.tableIds?.length;
  const link=document.getElementById('openTournament');
  if(link){link.hidden=!event;link.href='turnier_ergebnisse.html?turnier='+encodeURIComponent(selectEvent.value);}
 }
 if(!kiosk)selectEvent.addEventListener("change",showAssigned);
 async function refresh(action='state'){
  if(busy)return;busy=true;
  try{
   if(kiosk){
    const data=await rpc({p_action:'heartbeat',p_table:table});
    message.textContent='Verbunden';
    const a=data.assignment,s=a?.snapshot;
    document.getElementById('title').textContent=a?.title||'';
    const players=document.getElementById('players');players.replaceChildren();
    if(a){for(const seed of [a.seed1,a.seed2])players.append(node('div',s.participants.find(p=>Number(p.seed)===Number(seed))?.name||'Spieler'));
     players.append(node('small',`Ziel ${s.playingTargetPoints || '–'} · Aufnahmen ${s.playingTargetInnings || '–'}`));}
    document.getElementById('state').textContent=data.paused?'Turnier pausiert':a?'Partie zugewiesen · Eingabe folgt':data.event_id?'Wartet auf die nächste Partie':'Bereit · Warte auf Turnierstart';
   }else{
    const select=document.getElementById('event');
    if(action==='stop'&&!confirm('Tischbetrieb beenden? Gespeicherte Ergebnisse bleiben erhalten.'))return;
    const data=await rpc({p_action:action,p_event:select.value||null});
    events=data.events;
    const previous=select.value;select.replaceChildren(node('option','Turnier wählen …'));select.firstChild.value='';
    for(const event of data.events){const o=node('option',event.title+(event.status==='completed'?' · abgeschlossen':''));o.value=event.id;select.append(o);}select.value=previous;showAssigned();
    const container=document.getElementById('tables');container.replaceChildren();
    for(const t of data.tables){
     const card=node('article',''),label=node('h2',t.id.toUpperCase());
     const online=Date.now()-Date.parse(t.last_seen)<30000;const status=node('p',online?'Verbunden':'Offline');status.className=online?'online':'offline';
     const event=data.events.find(e=>e.id===t.event_id);
     const link=node('a','Tischdisplay öffnen');link.href='turnier_tisch.html?tisch='+t.id;link.target='_blank';link.rel='noopener';
     card.append(label,status,node('p',event?event.title+(t.paused?' · pausiert':' · gestartet'):'Bereit für Turnier'),link);container.append(card);
    }
    document.getElementById('controls').hidden=false;message.textContent=action==='state'?'': 'Aktion ausgeführt.';
   }
  }catch(error){message.textContent='Verbindung/Aktion fehlgeschlagen: '+error.message;if(kiosk){document.getElementById('state').textContent='Verbindung unterbrochen · erneuter Versuch …';document.getElementById('players').replaceChildren();}}
  finally{busy=false;}
 }
 if(!kiosk)for(const action of ['start','pause','resume','stop'])document.getElementById(action).addEventListener('click',()=>refresh(action));
 await refresh();setInterval(()=>refresh(),5000);
})();
