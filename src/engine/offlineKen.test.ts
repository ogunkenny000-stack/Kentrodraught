import { afterEach, describe, expect, it, vi } from 'vitest';
import { offlineKenMove } from './offlineKen';
import { createInitialBoard, generateLegalMoves, moveToHubString } from '../gameLogic';
class FixtureWorker {
  static latest: FixtureWorker;
  onmessage: ((event: {data: unknown}) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((_message: {seconds: number}) => {});
  constructor() { FixtureWorker.latest = this; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('offline engine failure recovery', () => {
  it('rejects a malformed worker response immediately and releases the worker', async () => {
    vi.stubGlobal('Worker', FixtureWorker);
    const result = offlineKenMove(createInitialBoard(), 'W');
    const assertion = expect(result).rejects.toThrow('invalid evaluation');
    FixtureWorker.latest.onmessage?.({ data: null });
    await assertion;
    expect(FixtureWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('cancels CPU work and rejects without waiting for a result', async () => {
    vi.stubGlobal('Worker', FixtureWorker);
    const controller = new AbortController();
    const result = offlineKenMove(createInitialBoard(), 'W', 5, 0, false, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await assertion;
    expect(FixtureWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('uses a finite search budget and times out an unresponsive worker', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FixtureWorker);
    const result = offlineKenMove(createInitialBoard(), 'W', Infinity);
    const assertion = expect(result).rejects.toThrow('timed out');
    expect(FixtureWorker.latest.postMessage.mock.calls[0][0].seconds).toBe(5);
    await vi.advanceTimersByTimeAsync(65000); await assertion;
    expect(FixtureWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});

it('reuses a completed depth-30 position without creating another worker', async () => {
  vi.stubGlobal('Worker', FixtureWorker);
  const board = createInitialBoard();
  const first = offlineKenMove(board, 'W', 0, 30);
  const worker = FixtureWorker.latest;
  worker.onmessage?.({data:{result:{move:moveToHubString(generateLegalMoves(board,'W')[0]),score:0,depth:30,nodes:123,pv:'31-26'}}});
  const completed = await first;
  expect(await offlineKenMove(board,'W',0,30)).toEqual(completed);
  expect(FixtureWorker.latest).toBe(worker);
  expect(worker.postMessage).toHaveBeenCalledOnce();
});
