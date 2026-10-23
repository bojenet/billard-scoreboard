(async () => {
 try {
  const user=await getCurrentUser();
  if(user && await hasAdminAccess(user))document.getElementById('operation-link').hidden=false;
 }catch(error){console.warn('Tischbetrieb-Zugriff konnte nicht geprüft werden.',error);}
})();
