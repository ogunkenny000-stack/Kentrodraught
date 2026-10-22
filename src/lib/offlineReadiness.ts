export interface OfflineStatus { ready: boolean; missing: number; preparing?: boolean; }
async function askWorker(type: string, timeoutMs: number): Promise<OfflineStatus> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) throw new Error('Offline play needs this app opened over HTTPS.');
  const registration = await navigator.serviceWorker.getRegistration();
  const worker = registration?.active;
  if (!worker) return { ready: false, missing: 0, preparing: true };
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const cleanup = () => { clearTimeout(timer); channel.port1.close(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Offline preparation has not responded. Reload online and try again.')); }, timeoutMs);
    channel.port1.onmessage = ({ data }) => {
      cleanup();
      if (data?.error) reject(new Error('Some offline files could not be saved. Check your connection and available storage, then retry.'));
      else if (typeof data?.ready === 'boolean' && Number.isInteger(data?.missing)) resolve(data);
      else reject(new Error('Reload online to update offline support.'));
    };
    try { worker.postMessage({ type }, [channel.port2]); }
    catch (error) { cleanup(); reject(error); }
  });
}
export const readOfflineStatus = () => askWorker('KENTRO_OFFLINE_STATUS', 5_000);
export const prepareOfflineFiles = () => askWorker('KENTRO_PREPARE_OFFLINE', 180_000);
