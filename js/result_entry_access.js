// A dedicated entry point for users assigned to record tournament results.
async function getResultEntryContext() {
    const {data,error}=await supabaseClient.rpc('result_entry_context');
    if(error)throw error;
    if(!data || typeof data.result_only!=='boolean' || !Array.isArray(data.events))throw new Error('Turnierzugänge konnten nicht geladen werden.');
    return data;
}
function resultEntryPath(context,preferredPath='') {
    if(!context.result_only)return preferredPath;
    const target=new URL(preferredPath || '/turnier_ergebnisse.html',window.location.origin);
    // Preserve invitation and password-setup links for result entry.
    if(target.origin===window.location.origin && target.pathname==='/turnier_ergebnisse.html')return target.pathname+target.search;
    return '/turnier_ergebnisse.html';
}
