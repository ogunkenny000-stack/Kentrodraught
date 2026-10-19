/* The native engine runs exclusively in this worker, keeping the board responsive. */
importScripts('/engine/scan.js');
const engine = createKenEngine({ locateFile: name => '/engine/' + name,
  print: () => {}, printErr: message => console.error('[Ken]', message) })
  .then(module => { module.ccall('ken_init', null, [], []); return module; });
self.onmessage = async ({ data }) => {
  try {
    const module = await engine;
    const result = JSON.parse(module.ccall('ken_search', 'string',
      ['string', 'number', 'number', 'number'], [data.fen, data.seconds, data.depth, data.pst ? 1 : 0]));
    self.postMessage({ result });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
