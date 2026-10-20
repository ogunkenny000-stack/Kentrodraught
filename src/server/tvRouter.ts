import { Router } from 'express';
import { getSupabaseAdmin, verifyAccessToken } from '../../supabaseAdmin';
import { requirePermission } from '../../adminService';
import { requestAccessToken } from './httpAuth';
import { getGameRecordByCode } from './gameRecordsManager';
import { TVBroadcastBuffer } from './tvBroadcast';
import { insertNotification } from './notifications';
const validKey = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{3,80}$/.test(v);
export function createTVRouter(buffer: TVBroadcastBuffer) {
    const router = Router();
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    const run = (fn: any) => (req: any, res: any) => Promise.resolve(fn(req, res)).catch(() => res.status(503).json({ error: 'TV service temporarily unavailable. Please retry.' }));
    const publicKey = async (key: string) => buffer.list().some(r => r.gameCode === key) || !!(await getGameRecordByCode(key).then(g => g && !g.private));
    const identity = async (req: any) => verifyAccessToken(requestAccessToken(req.headers));
    let ratings: {
        at: number;
        values: Record<string, number>;
    } = { at: 0, values: {} };
    router.get('/live', run(async (_req: any, res: any) => { const rooms = buffer.list(); if (rooms.length && Date.now() - ratings.at > 30000 && process.env.SUPABASE_SECRET_KEY) {
        const { data, error } = await getSupabaseAdmin().from('profiles').select('usernameLower,elo').in('usernameLower', [...new Set(rooms.flatMap(r => [r.white.toLowerCase(), r.black.toLowerCase()]))]);
        if (!error)
            ratings = { at: Date.now(), values: Object.fromEntries((data || []).map(p => [p.usernameLower, p.elo])) };
    } res.json({ rooms: rooms.map(r => ({ ...r, whiteRating: ratings.values[r.white.toLowerCase()] ?? null, blackRating: ratings.values[r.black.toLowerCase()] ?? null })), delaySeconds: buffer.delayMs / 1000 }); }));
    router.get('/me', run(async (req: any, res: any) => { const uid = await identity(req); res.json({ signedIn: !!uid, canCommentate: uid ? !!await requirePermission(requestAccessToken(req.headers), 'manage_announcements') : false, canModerate: uid ? !!await requirePermission(requestAccessToken(req.headers), 'manage_reports') : false }); }));
    router.get('/follows', run(async (req: any, res: any) => { const uid = await identity(req); if (!uid)
        return res.json({ follows: [] }); const { data, error } = await getSupabaseAdmin().from('kentro_tv_follows').select('player_id,player_name').eq('follower_id', uid); if (error)
        throw error; if(!data?.length)return res.json({follows:[]});const {data:profiles,error:readError}=await getSupabaseAdmin().from('profiles').select('ownerId,usernameLower').in('ownerId',data.map(f=>f.player_id));if(readError)throw readError;const names=new Map((profiles||[]).map(p=>[p.ownerId,p.usernameLower]));res.json({ follows: data.map(f=>({...f,player_name:names.get(f.player_id)||f.player_name})) }); }));
    router.post('/follows', run(async (req: any, res: any) => { const uid = await identity(req); if (!uid)
        return res.status(401).json({ error: 'Sign in to follow players.' }); const name = String(req.body.player || '').trim().toLowerCase().slice(0, 60), db = getSupabaseAdmin(); const { data: profile, error } = await db.from('profiles').select('ownerId,usernameLower').eq('usernameLower', name).maybeSingle(); if (error)
        throw error; if (!profile?.ownerId || profile.ownerId === uid)
        return res.status(422).json({ error: 'Choose another registered player.' }); const { error: write } = req.body.following === false ? await db.from('kentro_tv_follows').delete().eq('follower_id', uid).eq('player_id', profile.ownerId) : await db.from('kentro_tv_follows').upsert({ follower_id: uid, player_id: profile.ownerId, player_name: profile.usernameLower }, { onConflict: 'follower_id,player_id' }); if (write)
        throw write; res.json({ ok: true }); }));
    router.get('/tournaments', run(async (_req: any, res: any) => { const { data, error } = await getSupabaseAdmin().from('tournaments').select('*').order('createdAt', { ascending: false }).limit(30); if (error)
        throw error; res.json({ tournaments: (data || []).filter((t: any) => t.visibility !== 'private' && !t.private && t.spectatorPermission !== false).map((t: any) => ({ id: t.id, name: t.name, status: t.status, standings: (Array.isArray(t.players) ? t.players : []).filter((p: any) => p && typeof p === 'object').map((p: any) => ({ username: p.username, points: p.points ?? 0, wins: p.wins ?? 0, buchholz: p.buchholz ?? 0, rating: p.rating ?? 0 })).sort((a: any, b: any) => b.points - a.points || b.buchholz - a.buchholz || b.rating - a.rating || String(a.username).toLowerCase().localeCompare(String(b.username).toLowerCase(), "en")), matches: (Array.isArray(t.matches) ? t.matches : []).map((m: any) => ({ id: m.id, round: m.round, white: m.white, black: m.black, winner: m.winner, status: m.status, roomId: m.roomId, gameCode: m.gameCode })), players: (t.players || []).map((p: any) => typeof p === 'string' ? p : p.username).filter(Boolean) })) }); }));
    router.get('/feed/:key', run(async (req: any, res: any) => { const key = req.params.key; if (!validKey(key) || !await publicKey(key))
        return res.status(404).json({ error: 'Public broadcast unavailable.' }); const { data, error } = await getSupabaseAdmin().from('kentro_tv_comments').select('id,author,body,ply,caster,arrows,created_at').eq('broadcast_key', key).eq('hidden', false).order('created_at', { ascending: false }).limit(100); if (error)
        throw error; res.json({ comments: (data || []).reverse() }); }));
    router.post('/feed/:key', run(async (req: any, res: any) => { const uid = await identity(req); if (!uid)
        return res.status(401).json({ error: 'Sign in to join the discussion.' }); const key = req.params.key; if (!validKey(key) || !await publicKey(key))
        return res.status(404).json({ error: 'Public broadcast unavailable.' }); const body = typeof req.body.body === 'string' ? req.body.body.trim() : '', ply = req.body.ply; if (!body || body.length > 500 || !Number.isInteger(ply) || ply < 0 || ply > 2000)
        return res.status(422).json({ error: 'Write 1–500 characters at a valid move.' }); const db = getSupabaseAdmin(), { data: mute, error: muteError } = await db.from('kentro_tv_mutes').select('expires_at').eq('user_id', uid).maybeSingle(); if (muteError)
        throw muteError; if (mute && Date.parse(mute.expires_at) > Date.now())
        return res.status(403).json({ error: 'Your broadcast chat is temporarily muted.' }); const caster = !!await requirePermission(requestAccessToken(req.headers), 'manage_announcements'); const arrows = caster && Array.isArray(req.body.arrows) ? req.body.arrows.slice(0, 6).filter((a: any) => Array.isArray(a) && a.length === 2 && a.every((s: any) => Number.isInteger(s) && s >= 1 && s <= 50) && a[0] !== a[1]) : []; const { data: profile, error: profileError } = await db.from('profiles').select('username,banned,suspendedUntil').eq('ownerId', uid).single(); if (profileError)
        throw profileError; if (profile.banned || Number(profile.suspendedUntil) > Date.now())
        return res.status(403).json({ error: 'This account cannot post while restricted.' }); const { error } = await db.from('kentro_tv_comments').insert({ broadcast_key: key, author_id: uid, author: profile.username, body, ply, caster, arrows }); if (error)
        throw error; res.json({ ok: true }); }));
    router.post('/reports', run(async (req: any, res: any) => { const uid = await identity(req); if (!uid)
        return res.status(401).json({ error: 'Sign in to report a broadcast.' }); const key = req.body.key, reason = String(req.body.reason || '').trim(); if (!validKey(key) || reason.length < 3 || reason.length > 500 || !await publicKey(key))
        return res.status(422).json({ error: 'Choose a public broadcast and describe the issue.' }); const db = getSupabaseAdmin(); if (req.body.commentId) {
        const { data, error } = await db.from('kentro_tv_comments').select('id').eq('id', req.body.commentId).eq('broadcast_key', key).maybeSingle();
        if (error)
            throw error;
        if (!data)
            return res.status(422).json({ error: 'Comment does not belong to this broadcast.' });
    } const { error } = await db.from('kentro_tv_reports').insert({ reporter_id: uid, broadcast_key: key, reason, comment_id: req.body.commentId || null }); if (error)
        throw error; res.json({ ok: true }); }));
    router.get('/reports', run(async (req: any, res: any) => { if (!await requirePermission(requestAccessToken(req.headers), 'manage_reports'))
        return res.status(403).json({ error: 'Moderator access required.' }); const { data, error } = await getSupabaseAdmin().from('kentro_tv_reports').select('*').eq('resolved', false).order('created_at').limit(100); if (error)
        throw error; res.json({ reports: data }); }));
    router.post('/moderate', run(async (req: any, res: any) => { const moderator = await requirePermission(requestAccessToken(req.headers), 'manage_reports'); if (!moderator)
        return res.status(403).json({ error: 'Moderator access required.' }); const db = getSupabaseAdmin(), id = req.body.reportId; if (typeof id !== 'string')
        return res.status(422).json({ error: 'Choose a report.' }); const { data: report, error } = await db.from('kentro_tv_reports').select('*').eq('id', id).single(); if (error)
        throw error; if (req.body.action === 'hide' || req.body.action === 'mute') {
        const { data: comment, error: readError } = await db.from('kentro_tv_comments').select('author_id').eq('id', report.comment_id).single();
        if (readError)
            throw readError;
        const { error: hide } = await db.from('kentro_tv_comments').update({ hidden: true }).eq('id', report.comment_id);
        if (hide)
            throw hide;
        if (req.body.action === 'mute') {
            const { error: muted } = await db.from('kentro_tv_mutes').upsert({ user_id: comment.author_id, moderator_id: moderator.uid, expires_at: new Date(Date.now() + 86400000).toISOString() });
            if (muted)
                throw muted;
        }
    }
    else if (req.body.action !== 'resolve')
        return res.status(422).json({ error: 'Invalid moderation action.' }); const { error: done } = await db.from('kentro_tv_reports').update({ resolved: true }).eq('id', id); if (done)
        throw done; res.json({ ok: true }); }));
    return router;
}
export async function notifyTVFollowers(buffer: TVBroadcastBuffer) {
    const rooms = buffer.list();
    if (!rooms.length)
        return;
    const names = [...new Set(rooms.flatMap(r => [r.white.toLowerCase(), r.black.toLowerCase()]))];
    const {data:profiles,error:profileError}=await getSupabaseAdmin().from('profiles').select('ownerId,usernameLower').in('usernameLower',names);
    if(profileError)throw profileError;if(!profiles?.length)return;
    const owners=new Map(profiles.filter(p=>p.ownerId).map(p=>[p.ownerId,p.usernameLower]));
    for (let offset = 0;; offset += 500) {
        const { data, error } = await getSupabaseAdmin().from('kentro_tv_follows').select('follower_id,player_id').in('player_id', [...owners.keys()]).order('follower_id').order('player_id').range(offset, offset + 499);
        if (error)
            throw error;
        for (const follow of data || []) {
            const room = rooms.find(r => [r.white.toLowerCase(), r.black.toLowerCase()].includes(owners.get(follow.player_id)||''));
            if (room)
                await insertNotification(follow.follower_id, 'system', 'A player you follow is on Kentro TV', `${room.white} vs ${room.black}`, `/?tvRoom=${encodeURIComponent(room.roomId)}`, `tv:${room.gameCode}:${follow.player_id}`);
        }
        if (!data || data.length < 500)
            break;
    }
}
