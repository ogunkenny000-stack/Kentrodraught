/* A human's private pairing key never leaves this page. */
(() => {
  'use strict';
  const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0));
  window.bridgePairing = async callback => {
    if (!window.isSecureContext || !window.crypto?.subtle) throw new Error('Pairing requires HTTPS or a local test origin.');
    const panel = document.createElement('section');
    const title = document.createElement('h2'); title.textContent = 'Pair this browser with your assistant';
    const note = document.createElement('p'); note.textContent = 'Share the fingerprint below with your assistant to connect this browser. Keep this tab open until you finish; reloading ends your access. Enter account details only in the browser view after pairing.';
    const status = document.createElement('p'); status.textContent = 'Creating a local pairing key…';
    const fingerprint = document.createElement('pre'); fingerprint.style.whiteSpace = 'pre-wrap';
    panel.append(title, note, fingerprint, status); document.body.prepend(panel);
    const keys = await crypto.subtle.generateKey({name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, false, ['encrypt', 'decrypt']);
    const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const registered = await fetch('/pair/request', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({public_key: publicKey}), cache: 'no-store'});
    const pair = await registered.json();
    if (!registered.ok || !pair.ok) throw new Error(pair.error || 'Pairing request failed.');
    fingerprint.textContent = pair.fingerprint;
    status.textContent = 'Tell your assistant this full fingerprint. Waiting for approval…';
    while (Date.now() < pair.expires_at * 1000) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const response = await fetch('/pair/result/' + encodeURIComponent(pair.pairing_id), {cache: 'no-store'});
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Pairing expired. Reload this page.');
      if (result.fingerprint !== pair.fingerprint) throw new Error('Pairing fingerprint changed.');
      if (result.state === 'approved') {
        const decrypted = await crypto.subtle.decrypt({name: 'RSA-OAEP'}, keys.privateKey, decode(result.ciphertext));
        const capability = new TextDecoder('utf-8', {fatal: true}).decode(decrypted);
        if (capability.length < 32 || capability.length > 120) throw new Error('Invalid pairing capability.');
        status.textContent = 'Paired. You can now take control of the browser.';
        await callback(capability);
        panel.remove();
        return;
      }
    }
    throw new Error('Pairing expired. Reload this page to create a new local key.');
  };
})();
