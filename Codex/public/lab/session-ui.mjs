window.addEventListener('vn100-api-error',({detail})=>{
  if(!['API_AUTH_REQUIRED','API_HTML_RESPONSE'].includes(detail?.code))return;
  document.getElementById('session-recovery').hidden=false;
  document.getElementById('session-recovery-message').textContent=detail.message;
  document.getElementById('session-recovery-signin').hidden=detail.code!=='API_AUTH_REQUIRED';
  document.getElementById('session-recovery-open').hidden=detail.code==='API_AUTH_REQUIRED';
});
