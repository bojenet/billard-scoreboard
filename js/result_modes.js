/* Shared result-entry modes. The server validates the same modes independently. */
(function(root){
    'use strict';
    const modes={
        T3:{count:4,kind:'roundRobin'},T4:{count:5,kind:'roundRobin'},T5:{count:5,kind:'roundRobin'},
        T7:{count:6,kind:'roundRobin'},T8:{count:6,kind:'roundRobin'},
        T11:{count:7,kind:'roundRobin'},T12:{count:7,kind:'roundRobin'},
        T10:{count:7,kind:'groupKo',label:'2 Gruppen à 3 und 4 Spieler'},T15:{count:8,kind:'groupKo',label:'2 Gruppen à 4 Spieler'},T16:{count:9,kind:'groupKo',label:'2 Gruppen à 5 und 4 Spieler'},T16b:{count:9,kind:'groupKo',groups:['A','B','C'],label:'3 Gruppen à 3 Spieler'},T18:{count:10,kind:'groupKo',label:'2 Gruppen à 5 Spieler'},T19:{count:10,kind:'groupKo',label:'2 Gruppen à 5 Spieler'}
    };
    function get(code){return Object.hasOwn(modes,code) ? modes[code] : null;}
    const list=()=>Object.entries(modes).map(([code,mode])=>({code,...mode,label:mode.label || `${mode.count} Spieler · Jeder gegen jeden`}));
    const api={get,list,supports:code=>!!get(code),forCount:count=>list().filter(mode=>mode.count===count)};
    if(typeof module!=='undefined' && module.exports)module.exports=api;else root.ResultModes=api;
})(typeof globalThis!=='undefined' ? globalThis : this);
