(async () => {
 try {
  const user=await getCurrentUser();
  if(user && await hasAdminAccess(user)) {
   const link=document.getElementById('operation-link');
   link.href='turnier_displaybetrieb.html';link.textContent='Turnierbetrieb mit Displays';link.hidden=false;
  }
 }catch(error){console.warn('Tischbetrieb-Zugriff konnte nicht geprüft werden.',error);}
})();
