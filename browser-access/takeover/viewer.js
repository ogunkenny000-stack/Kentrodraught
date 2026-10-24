'use strict';
(() => {
  let token = new URLSearchParams(location.hash.slice(1)).get('owner');
  history.replaceState(null, '', location.pathname);
  const screen = document.querySelector('#screen'), ctx = screen.getContext('2d');
  const status = document.querySelector('#status'), security = document.querySelector('#security');
  const take = document.querySelector('#take'), release = document.querySelector('#release');
  const kaggle = document.querySelector('#kaggle'), signin = document.querySelector('#signin');
  let lease = null, stream = null, metadata = null, queue = Promise.resolve();
  const message = text => { status.textContent = text; };
  function headers() {
    const values = {'Authorization': 'Bearer ' + token};
    if (lease) values['X-Owner-Lease'] = lease;
    return values;
  }
  async function api(path, data) {
    const response = await fetch(path, {method: data === undefined ? 'GET' : 'POST',
      headers: {...headers(), ...(data === undefined ? {} : {'Content-Type':'application/json'})},
      body: data === undefined ? undefined : JSON.stringify(data), cache:'no-store', credentials:'omit'});
    const value = await response.json();
    if (!response.ok || !value.ok) throw new Error(value.error || 'Browser request failed');
    return value;
  }
  function update(value) {
    metadata = value;
    document.querySelector('#url').textContent = value.url || 'No page';
    security.textContent = value.credential_entry_ready
      ? 'Sandbox and HTTPS verification are enabled. Account sign-in is still unverified.'
      : 'PUBLIC PREVIEW: account credential entry is disabled. A sandbox-capable, verified browser is required.';
    signin.disabled = !lease || !value.credential_entry_ready;
  }
  async function startFrames() {
    // Quick Tunnel does not support SSE. Authenticated polling also avoids
    // placing owner capabilities in an EventSource URL.
    stream = new AbortController();
    const signal = stream.signal;
    while (lease && !signal.aborted) {
      const response = await fetch('/owner/frame', {headers:headers(), signal,
        cache:'no-store', credentials:'omit'});
      if (!response.ok) throw new Error('The owner frame was refused');
      const bitmap = await createImageBitmap(await response.blob());
      if (lease && !signal.aborted) ctx.drawImage(bitmap,0,0,screen.width,screen.height);
      bitmap.close();
      update(await api('/owner/status'));
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }
  function input(data) {
    if (!lease) return;
    if (metadata && metadata.protected && !metadata.credential_entry_ready) {
      message('Credential entry is disabled in this public-preview browser.'); return;
    }
    queue = queue.then(() => api('/owner/action',data)).then(update).catch(error => message(error.message));
  }
  take.onclick = async () => {
    if (!token) { message('The private owner capability is missing. Obtain a link from your trusted operator.'); return; }
    try {
      const value = await api('/owner/acquire',{}); lease = value.lease; update(value);
      take.disabled = true; release.disabled = kaggle.disabled = false;
      message('You control this browser. Agent page reads and actions are paused.');
      startFrames().catch(error => { if (error.name !== 'AbortError') message(error.message); });
    } catch(error) { message(error.message); }
  };
  kaggle.onclick = () => input({kind:'navigate',url:'https://www.kaggle.com/'});
  signin.onclick = () => input({kind:'navigate',url:'https://www.kaggle.com/account/login'});
  release.onclick = async () => {
    try {
      await api('/owner/release',{}); lease = null; if (stream) stream.abort();
      take.disabled = false; release.disabled = kaggle.disabled = signin.disabled = true;
      message('Control returned to the agent. Authentication values were not returned.');
    } catch(error) { message(error.message + '. Return to Kaggle after finishing sign-in.'); }
  };
  screen.onclick = event => {
    screen.focus(); const rect = screen.getBoundingClientRect();
    input({kind:'click',x:(event.clientX-rect.left)*screen.width/rect.width,
      y:(event.clientY-rect.top)*screen.height/rect.height});
  };
  screen.onwheel = event => { event.preventDefault(); input({kind:'wheel',dx:Math.max(-4096,Math.min(4096,event.deltaX)),dy:Math.max(-4096,Math.min(4096,event.deltaY))}); };
  screen.onkeydown = event => {
    // Let the local browser dispatch paste; forward its text without retaining it.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
    event.preventDefault();
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      input({kind:'text',text:event.key}); return;
    }
    if (['Control','Shift','Alt','Meta'].includes(event.key)) return;
    const modifiers = [event.ctrlKey?'Control':null,event.metaKey?'Meta':null,event.altKey?'Alt':null,event.shiftKey?'Shift':null].filter(Boolean);
    const key = event.key === ' ' ? 'Space' : event.key;
    input({kind:'key',key:[...modifiers,key].join('+')});
  };
  screen.onpaste = event => { event.preventDefault(); input({kind:'text',text:event.clipboardData.getData('text').slice(0,4096)}); };
  if (!token) {
    take.disabled = true;
    (async () => {
      const config = await (await fetch('/config', {cache:'no-store', credentials:'omit'})).json();
      if (!config.pairing_enabled) return;
      await new Promise((resolve,reject) => {
        const script = document.createElement('script'); script.src = '/pairing.js';
        script.onload = resolve; script.onerror = () => reject(new Error('Pairing module could not load'));
        document.head.appendChild(script);
      });
      if (typeof window.bridgePairing !== 'function') throw new Error('Pairing module is unavailable');
      await window.bridgePairing(ownerToken => {
        if (typeof ownerToken !== 'string' || ownerToken.length < 32) throw new Error('Invalid pairing response');
        token = ownerToken; take.disabled = false;
        message('Private viewer paired. You can now take browser control.');
      });
    })().catch(error => message(error.message));
  }
})();
