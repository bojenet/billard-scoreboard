/* Shared result-entry modes. The server validates the same modes independently. */
(function(root){
    'use strict';
    const modes={
        T3:{count:4,kind:'roundRobin'},T4:{count:5,kind:'roundRobin'},T5:{count:5,kind:'roundRobin'},
        T7:{count:6,kind:'roundRobin'},T8:{count:6,kind:'roundRobin'},
        T11:{count:7,kind:'roundRobin'},T12:{count:7,kind:'roundRobin'},
        T10:{count:7,kind:'groupKo'},T15:{count:8,kind:'groupKo'},T19:{count:10,kind:'groupKo'}
    };
    function get(code){return Object.hasOwn(modes,code) ? modes[code] : null;}
    const api={get,supports:code=>!!get(code)};
    if(typeof module!=='undefined' && module.exports)module.exports=api;else root.ResultModes=api;
})(typeof globalThis!=='undefined' ? globalThis : this);
