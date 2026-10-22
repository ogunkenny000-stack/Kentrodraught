import {beforeEach,afterEach,expect,it,vi} from 'vitest';
let win: EventTarget & {matchMedia:any};
beforeEach(()=>{vi.resetModules();win=Object.assign(new EventTarget(),{matchMedia:vi.fn(()=>({matches:false,addEventListener:vi.fn()}))});vi.stubGlobal('window',win);vi.stubGlobal('navigator',{userAgent:'Chrome Android',platform:'Linux',maxTouchPoints:1});});
afterEach(()=>vi.unstubAllGlobals());
it('retains a native install event before any button subscribes',async()=>{
 const p=await import('./pwaInstall');p.initializeInstallPrompt();const event=Object.assign(new Event('beforeinstallprompt',{cancelable:true}),{prompt:vi.fn().mockResolvedValue(undefined),userChoice:Promise.resolve({outcome:'accepted'})});win.dispatchEvent(event);
 expect(event.defaultPrevented).toBe(true);expect(p.getInstallState().promptReady).toBe(true);expect(await p.requestPwaInstall()).toBe('accepted');expect(event.prompt).toHaveBeenCalledTimes(1);expect(p.getInstallState().hidden).toBe(true);
});
it('consumes a dismissed prompt once and keeps manual installation available',async()=>{
 const p=await import('./pwaInstall');p.initializeInstallPrompt();const event=Object.assign(new Event('beforeinstallprompt'),{prompt:vi.fn().mockResolvedValue(undefined),userChoice:Promise.resolve({outcome:'dismissed'})});win.dispatchEvent(event);expect(await p.requestPwaInstall()).toBe('dismissed');expect(await p.requestPwaInstall()).toBe('help');expect(event.prompt).toHaveBeenCalledTimes(1);expect(p.getInstallState().hidden).toBe(false);
});
it('shows help when no native prompt exists or it fails',async()=>{
 const p=await import('./pwaInstall');p.initializeInstallPrompt();expect(await p.requestPwaInstall()).toBe('help');win.dispatchEvent(Object.assign(new Event('beforeinstallprompt'),{prompt:vi.fn().mockRejectedValue(Error('unsupported'))}));expect(await p.requestPwaInstall()).toBe('help');expect(p.getInstallState().busy).toBe(false);
});
it('hides install controls in standalone mode and after installation',async()=>{
 win.matchMedia.mockReturnValue({matches:true,addEventListener:vi.fn()});const p=await import('./pwaInstall');p.initializeInstallPrompt();expect(p.getInstallState().hidden).toBe(true);
});
it('notifies every install control when the app is installed',async()=>{
 const p=await import('./pwaInstall');p.initializeInstallPrompt();const callback=vi.fn();const off=p.subscribeInstall(callback);win.dispatchEvent(new Event('appinstalled'));expect(p.getInstallState().hidden).toBe(true);expect(callback).toHaveBeenCalledOnce();off();win.dispatchEvent(new Event('appinstalled'));expect(callback).toHaveBeenCalledOnce();
});
it('recognizes iPad desktop mode and Android',async()=>{
 const p=await import('./pwaInstall');expect(p.installPlatform()).toBe('android');vi.stubGlobal('navigator',{userAgent:'Macintosh Safari',platform:'MacIntel',maxTouchPoints:5});expect(p.installPlatform()).toBe('ios');
});
