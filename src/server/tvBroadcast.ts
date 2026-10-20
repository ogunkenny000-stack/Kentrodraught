import type { Board, Move } from '../gameLogic';
export type TVSnapshot = {
    roomId: string;
    gameCode: string;
    white: string;
    black: string;
    board: Board;
    turn: 'W' | 'B';
    lastMove: Move | null;
    ply: number;
    timed?: boolean;
    whiteTime: number;
    blackTime: number;
    spectatorCount: number;
    phase: string;
    score: Record<string, number>;
    tournamentId?: string;
    capturedAt: number;
};
/** Only sanitized public room snapshots enter this buffer. Never expose the newest board. */
export class TVBroadcastBuffer {
    private history = new Map<string, TVSnapshot[]>();
    constructor(public readonly delayMs: number = 30000) { if (!Number.isInteger(delayMs) || delayMs < 15000 || delayMs > 300000)
        throw Error('TV delay must be 15–300 seconds'); }
    capture(rooms: TVSnapshot[], now = Date.now()) {
        const allowed = new Set(rooms.slice(0, 100).map(r => r.roomId));
        for (const key of this.history.keys())
            if (!allowed.has(key))
                this.history.delete(key);
        for (const room of rooms.slice(0, 100)) {
            const history = this.history.get(room.roomId) ?? [];
            if (history.at(-1)?.gameCode !== room.gameCode)
                history.length = 0;
            history.push(structuredClone({ ...room, capturedAt: now }));
            while (history.length > Math.ceil(this.delayMs / 1000) + 5)
                history.shift();
            this.history.set(room.roomId, history);
        }
    }
    list(now = Date.now()) { return [...this.history.values()].map(history => { const latest = history.at(-1)!; const delayed = [...history].reverse().find(s => s.capturedAt <= now - this.delayMs); return { roomId: latest.roomId, gameCode: latest.gameCode, white: latest.white, black: latest.black, tournamentId: latest.tournamentId, delaySeconds: this.delayMs / 1000, ready: !!delayed, snapshot: delayed ?? null }; }); }
}
