import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Crown, Flag, Handshake, RotateCcw, Share2, Wifi, X } from 'lucide-react';
import { captureClickTargets, generateLegalMoves, getCol, ngRcToSq, resolveCaptureClick, moveToNotationString } from '../../gameLogic';
import type { Move } from '../../gameLogic';
import {
  initialOfflineMatch, makeOfflineMoveMessage, makePairingCode, parsePairingCode, ensureNearbyCandidates,
  playOfflineMove, receiveOfflineMove, receiveOfflineReply,
} from '../../lib/offlineMatch';
import type { OfflineMatch, OfflineRequests, Side, WireMove } from '../../lib/offlineMatch';

const ICE_WAIT_MS = 12000;

type Role = 'host' | 'guest' | null;

type PeerMessage =
  | WireMove
  | { type: 'hello'; name: string }
  | { type: 'resign' }
  | { type: 'draw-offer' }
  | { type: 'draw-reply'; accept: boolean }
  | { type: 'rematch-request' }
  | { type: 'rematch-accept' }
  | { type: 'rematch-decline' };

/** Offline data channel: no STUN/TURN, account, WebSocket, Supabase or internet needed.
 * Offer and answer are exchanged manually (e.g. Nearby Share/Quick Share/AirDrop).
 * Browser Bluetooth cannot advertise a GATT server, so Wi-Fi/hotspot is the
 * realistic cross-platform browser transport. */
function waitForGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Your browser could not prepare the local Wi-Fi connection. Try switching Wi-Fi off and back on.'));
    }, ICE_WAIT_MS);
    const onChange = () => {
      if (peer.iceGatheringState === 'complete') {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      clearTimeout(timeout);
      peer.removeEventListener('icegatheringstatechange', onChange);
    };
    peer.addEventListener('icegatheringstatechange', onChange);
    onChange();
  });
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; } catch { /* legacy fallback */ }
  }
  const field = document.createElement('textarea');
  field.value = value;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy not available');
  } finally { field.remove(); }
}

export interface OfflineNearbyProps {
  onBack: () => void;
  username?: string;
}

export function OfflineNearby({ onBack, username }: OfflineNearbyProps) {
  const [role, setRole] = useState<Role>(null);
  const roleRef = useRef<Role>(null);
  const [connected, setConnected] = useState(false);
  const [wasConnected, setWasConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offerCode, setOfferCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [incomingCode, setIncomingCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [peerName, setPeerName] = useState('Nearby opponent');
  const [localName, setLocalName] = useState(() => (username || 'Player').slice(0, 24));
  const [match, setMatch] = useState<OfflineMatch>(() => initialOfflineMatch());
  const matchRef = useRef(match);
  const [selected, setSelected] = useState<number | null>(null);
  const [walked, setWalked] = useState<number[]>([]);
  const [requests, setRequests] = useState<OfflineRequests>({ drawIncoming: false, drawOutgoing: false, rematchIncoming: false, rematchOutgoing: false });
  const requestsRef = useRef(requests);
  const { drawIncoming, drawOutgoing, rematchIncoming, rematchOutgoing } = requests;
  const updateRequests = (changes: Partial<OfflineRequests>) => {
    requestsRef.current = { ...requestsRef.current, ...changes };
    setRequests(requestsRef.current);
  };
  const setDrawIncoming = (value: boolean) => updateRequests({ drawIncoming: value });
  const setDrawOutgoing = (value: boolean) => updateRequests({ drawOutgoing: value });
  const setRematchIncoming = (value: boolean) => updateRequests({ rematchIncoming: value });
  const setRematchOutgoing = (value: boolean) => updateRequests({ rematchOutgoing: value });
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pairingGeneration = useRef(0);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const mySide: Side = role === 'guest' ? 'B' : 'W';
  const otherSide: Side = mySide === 'W' ? 'B' : 'W';
  const isMyTurn = connected && !match.result && match.turn === mySide;

  const updateMatch = (next: OfflineMatch) => {
    matchRef.current = next;
    setMatch(next);
    setSelected(null);
    setWalked([]);
  };

  const send = (message: PeerMessage): boolean => {
    if (!channelRef.current || channelRef.current.readyState !== 'open') {
      setError('Nearby connection lost. Moves are paused so the boards stay in sync.');
      return false;
    }
    try { channelRef.current.send(JSON.stringify(message)); return true; }
    catch { setError('Could not send to opponent. Check the Wi-Fi connection.'); return false; }
  };

  const closePeer = () => {
    pairingGeneration.current++;
    if (channelRef.current) {
      channelRef.current.onopen = null;
      channelRef.current.onclose = null;
      channelRef.current.onmessage = null;
      channelRef.current.onerror = null;
      channelRef.current.close();
    }
    if (peerRef.current) {
      peerRef.current.ondatachannel = null;
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.close();
    }
    channelRef.current = null;
    peerRef.current = null;
  };

  const reset = () => {
    closePeer();
    roleRef.current = null;
    setRole(null);
    setConnected(false);
    setWasConnected(false);
    setBusy(false);
    setOfferCode('');
    setAnswerCode('');
    setIncomingCode('');
    setError('');
    setNotice('');
    setPeerName('Nearby opponent');
    setDrawIncoming(false);
    setDrawOutgoing(false);
    setRematchIncoming(false);
    setRematchOutgoing(false);
    updateMatch(initialOfflineMatch());
  };

  const restartGame = () => {
    updateMatch(initialOfflineMatch());
    setDrawIncoming(false);
    setDrawOutgoing(false);
    setRematchIncoming(false);
    setRematchOutgoing(false);
    setNotice('Rematch started. White plays first.');
  };

  // Latest callback refs keep the live data channel independent of React rerenders.
  const receiveRef = useRef<(raw: string) => void>(() => {});
  receiveRef.current = (raw: string) => {
    if (raw.length > 15000) { setError('Unexpected message from nearby player.'); return; }
    let msg: PeerMessage;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    const localSide: Side = roleRef.current === 'guest' ? 'B' : 'W';
    const remoteSide: Side = localSide === 'W' ? 'B' : 'W';
    switch (msg.type) {
      case 'hello':
        setPeerName(typeof msg.name === 'string' ? (msg.name.trim().slice(0, 24) || 'Nearby opponent') : 'Nearby opponent');
        break;
      case 'move':
        try {
          const next = receiveOfflineMove(matchRef.current, msg, remoteSide);
          updateMatch(next);
          setNotice(next.result ? (next.result.winner ? `${next.result.winner === 'W' ? 'White' : 'Black'} wins: ${next.result.reason}` : `Draw: ${next.result.reason}`) : 'Your turn!');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not verify opponent move.');
          channelRef.current?.close();
        }
        break;
      case 'resign':
        if (matchRef.current.result) break;
        updateMatch({ ...matchRef.current, result: { winner: localSide, reason: 'Opponent resigned' } });
        setNotice('Your opponent resigned. You win!');
        break;
      case 'draw-offer':
        if (!matchRef.current.result) { setDrawIncoming(true); setNotice('Opponent offers a draw.'); }
        break;
      case 'draw-reply':
        try {
          const next = receiveOfflineReply(matchRef.current, msg, requestsRef.current);
          setDrawOutgoing(false);
          if (next.result) setDrawIncoming(false);
          updateMatch(next);
          setNotice(msg.accept ? 'Draw agreed.' : 'Draw offer declined.');
        } catch (err) { setError(err instanceof Error ? err.message : 'Invalid draw response.'); }
        break;
      case 'rematch-request':
        if (matchRef.current.result) { setRematchIncoming(true); setNotice('Opponent requests a rematch.'); }
        break;
      case 'rematch-accept':
        try {
          receiveOfflineReply(matchRef.current, msg, requestsRef.current);
          restartGame();
        } catch (err) { setError(err instanceof Error ? err.message : 'Invalid rematch response.'); }
        break;
      case 'rematch-decline':
        setRematchOutgoing(false);
        setNotice('Rematch declined.');
        break;
    }
  };

  const installChannel = (channel: RTCDataChannel) => {
    channelRef.current = channel;
    channel.onopen = () => {
      if (channelRef.current !== channel) return;
      setConnected(true);
      setWasConnected(true);
      setError('');
      setNotice('Connected! White plays first.');
      channel.send(JSON.stringify({ type: 'hello', name: localName.trim().slice(0, 24) || 'Player' }));
    };
    channel.onclose = () => {
      if (channelRef.current !== channel) return;
      setConnected(false);
      setNotice('Nearby connection closed. To play again, reconnect both devices.');
    };
    channel.onmessage = event => {
      if (channelRef.current === channel && typeof event.data === 'string') receiveRef.current(event.data);
    };
    channel.onerror = () => setError('Nearby connection failed. Keep both devices on the same hotspot or Wi-Fi.');
  };

  const buildPeer = (nextRole: Exclude<Role, null>): RTCPeerConnection => {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support nearby peer connections. Use a recent Chrome, Edge or Safari.');
    closePeer();
    roleRef.current = nextRole;
    setRole(nextRole);
    setConnected(false);
    setError('');
    // No STUN/TURN servers: candidate exchange and all gameplay stay on the local network.
    const peer = new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all' });
    peerRef.current = peer;
    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) return;
      if (peer.connectionState === 'connected' && channelRef.current?.readyState === 'open') {
        setConnected(true);
        setError('');
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed' || peer.connectionState === 'disconnected') {
        setConnected(false);
        if (peer.connectionState === 'failed') setError('Could not connect. Join the SAME Wi-Fi or hotspot, and disable Wi-Fi client isolation.');
      }
    };
    if (nextRole === 'host') installChannel(peer.createDataChannel('kentro-nearby', { ordered: true }));
    else peer.ondatachannel = event => { if (peerRef.current === peer) installChannel(event.channel); };
    return peer;
  };

  const host = async () => {
    setBusy(true); setError(''); setOfferCode(''); setAnswerCode(''); setIncomingCode('');
    let generation = pairingGeneration.current;
    try {
      const peer = buildPeer('host');
      generation = pairingGeneration.current;
      const offer = await peer.createOffer();
      if (generation !== pairingGeneration.current) return;
      await peer.setLocalDescription(offer);
      if (generation !== pairingGeneration.current) return;
      await waitForGathering(peer);
      if (generation !== pairingGeneration.current) return;
      if (!peer.localDescription) throw new Error('No nearby offer available.');
      ensureNearbyCandidates(peer.localDescription.sdp);
      setOfferCode(makePairingCode(peer.localDescription));
      setNotice('Share the invitation with your opponent using Nearby Share, Quick Share or AirDrop.');
    } catch (e) { if (generation === pairingGeneration.current) { setError(e instanceof Error ? e.message : 'Unable to create a nearby match.'); setBusy(false); closePeer(); } }
    finally { if (generation === pairingGeneration.current) setBusy(false); }
  };

  const join = async () => {
    setBusy(true); setError('');
    let generation = pairingGeneration.current;
    try {
      const offer = parsePairingCode(incomingCode, 'offer');
      const peer = buildPeer('guest');
      generation = pairingGeneration.current;
      await peer.setRemoteDescription(offer);
      if (generation !== pairingGeneration.current) return;
      const answer = await peer.createAnswer();
      if (generation !== pairingGeneration.current) return;
      await peer.setLocalDescription(answer);
      if (generation !== pairingGeneration.current) return;
      await waitForGathering(peer);
      if (generation !== pairingGeneration.current) return;
      if (!peer.localDescription) throw new Error('No reply generated.');
      ensureNearbyCandidates(peer.localDescription.sdp);
      setAnswerCode(makePairingCode(peer.localDescription));
      setNotice('Send this reply back to the host. The host finishes the connection.');
    } catch (e) { if (generation === pairingGeneration.current) { setError(e instanceof Error ? e.message : 'Could not join.'); setBusy(false); closePeer(); } }
    finally { if (generation === pairingGeneration.current) setBusy(false); }
  };

  const finishHost = async () => {
    setBusy(true); setError('');
    const generation = pairingGeneration.current;
    try {
      const peer = peerRef.current;
      if (!peer || roleRef.current !== 'host') throw new Error('Create a host invitation first.');
      await peer.setRemoteDescription(parsePairingCode(incomingCode, 'answer'));
      if (generation === pairingGeneration.current) setNotice('Connecting to your opponent over Wi-Fi...');
    } catch (e) { if (generation === pairingGeneration.current) setError(e instanceof Error ? e.message : 'Invalid reply.'); }
    finally { if (generation === pairingGeneration.current) setBusy(false); }
  };

  const pasteFromClipboard = async () => {
    try {
      if (!navigator.clipboard?.readText) throw new Error('Clipboard access not available');
      setIncomingCode(await navigator.clipboard.readText());
      setError('');
    } catch { setError('Press and hold in the input field and select Paste.'); }
  };

  const share = async (value: string) => {
    setError('');
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Kentro Draught nearby match', text: value });
          setNotice('Connection code shared.');
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          // Unsupported share target: copy to clipboard instead.
        }
      }
      await copyText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setNotice('Code copied. Send it directly to the other device.');
    } catch { setError('Could not share automatically. Select the code below and copy it manually.'); }
  };

  const legal = useMemo(() => generateLegalMoves(match.board, match.turn), [match.board, match.turn]);
  const highlighted = useMemo(() => selected === null ? new Set<number>() : captureClickTargets(legal.filter(m => m.from === selected), walked), [legal, selected, walked]);
  const playable = useMemo(() => new Set(legal.map(m => m.from)), [legal]);

  const clickSquare = (sq: number) => {
    if (!isMyTurn) return;
    const piece = match.board[sq];
    if (piece && getCol(piece) === mySide) {
      if (!playable.has(sq)) { setNotice('A capture is required. Choose a highlighted piece.'); return; }
      setSelected(sq); setWalked([]); return;
    }
    if (selected === null) return;
    const res = resolveCaptureClick(legal.filter(m => m.from === selected), walked, sq);
    if (res.kind === 'extend') { setWalked(res.walked); return; }
    if (res.kind !== 'apply') { setSelected(null); setWalked([]); return; }
    const mv: Move = res.move;
    try {
      const next = playOfflineMove(matchRef.current, mv, mySide);
      if (!send(makeOfflineMoveMessage(matchRef.current, mv))) return;
      updateMatch(next);
      setNotice(next.result ? `Game over: ${next.result.reason}` : `${moveToNotationString(mv)} played. Opponent's turn.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not play move.'); }
  };

  const acceptDraw = (accept: boolean) => {
    if (!send({ type: 'draw-reply', accept })) return;
    setDrawIncoming(false);
    if (accept) updateMatch({ ...matchRef.current, result: { winner: null, reason: 'Draw agreed' } });
    setNotice(accept ? 'Draw agreed.' : 'Draw declined.');
  };

  // Only tear down the peer when leaving this mode, not on every render.
  useEffect(() => () => { closePeer(); }, []);
  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (channelRef.current?.readyState === 'open' && !matchRef.current.result) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, []);

  const leaveNearby = () => {
    // Going back is not an invisible disconnect/forfeit: explain it first.
    if (connected && !matchRef.current.result) {
      if (!window.confirm('Leave this nearby match? The game will end for your opponent.')) return;
      send({ type: 'resign' });
    }
    closePeer();
    onBack();
  };

  const code = role === 'host' ? offerCode : answerCode;
  const showBoard = wasConnected || match.history.length > 0;

  return (
    <div className="k-nearby-page min-h-full w-full bg-[#070913] text-slate-100 p-3 sm:p-6 overflow-y-auto font-sans">
      <div className="max-w-5xl mx-auto space-y-4 pb-12">
        <header className="flex items-center justify-between gap-3">
          <button onClick={leaveNearby} className="flex items-center gap-2 text-sm text-slate-300 hover:text-white px-3 py-2 rounded-xl border border-slate-800 bg-slate-900"><ArrowLeft size={16} /> Back</button>
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">No internet gameplay</span>
        </header>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5">
          <h1 className="text-xl font-black flex items-center gap-2"><Wifi className="text-emerald-400" /> Nearby Offline Game</h1>
          <a href="/?offline=ken" className="inline-block mt-3 text-amber-300 underline">Play Ken Offline · Full Strength</a>
          <p className="text-sm text-slate-400 mt-2">Play Nigerian Draughts face-to-face on two phones connected to the <strong className="text-slate-200">same Wi-Fi or hotspot</strong>. No game server, account, mobile data, coins or ratings involved.</p>
          <p className="text-xs text-amber-300 mt-2">Both players must have opened Kentro Draught while online and let offline preparation finish. Open Nearby Offline Game once and check it still opens after disconnecting mobile data. Browser pairing requires exchanging an invitation and a reply using Nearby Share / Quick Share / AirDrop, or copy and paste. Bluetooth-only gameplay is not supported.</p>
        </div>

        {!showBoard ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 space-y-4">
            <label className="text-xs font-bold text-slate-300 block">Your player name
              <input maxLength={24} value={localName} onChange={e => setLocalName(e.target.value)} className="mt-1.5 block w-full sm:max-w-sm px-3 py-2.5 bg-slate-950 text-white rounded-xl border border-slate-700" placeholder="Your name" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={host} disabled={busy} className={`rounded-xl p-4 border text-left transition ${role === 'host' ? 'border-emerald-400 bg-emerald-500/15' : 'border-slate-700 bg-slate-950 hover:border-emerald-500'} disabled:opacity-50`}><Crown className="text-amber-400 mb-2" /><strong className="block text-sm">Host Game</strong><span className="text-xs text-slate-400">I will invite a friend</span></button>
              <button onClick={() => { if (role !== 'guest') { closePeer(); setOfferCode(''); setAnswerCode(''); setIncomingCode(''); setRole('guest'); roleRef.current = 'guest'; setError(''); } }} disabled={busy} className={`rounded-xl p-4 border text-left transition ${role === 'guest' ? 'border-emerald-400 bg-emerald-500/15' : 'border-slate-700 bg-slate-950 hover:border-emerald-500'} disabled:opacity-50`}><Handshake className="text-sky-400 mb-2" /><strong className="block text-sm">Join Game</strong><span className="text-xs text-slate-400">A friend is hosting</span></button>
            </div>
            {role && (
              <div className="space-y-4 border-t border-slate-800 pt-4">
                <p className="text-xs text-slate-400 font-semibold">{role === 'host' ? '1. Send this invitation to your friend' : '1. Paste the invitation your friend sent you'}</p>
                {code && <>
                  <textarea aria-label="Your nearby connection code" value={code} readOnly onFocus={e => e.currentTarget.select()} rows={3} className="w-full resize-none bg-slate-950 border border-slate-700 text-slate-400 font-mono text-[10px] rounded-xl p-3" />
                  <div className="flex gap-2">
                    <button onClick={() => share(code)} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 text-xs"><Share2 size={15}/> Share / Nearby Share</button>
                    <button onClick={async () => { try { await copyText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setError('Please select and copy the code manually.'); } }} className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 text-xs font-bold">{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copied' : 'Copy'}</button>
                  </div>
                </>}
                {(role === 'guest' && !answerCode || role === 'host' && !!offerCode) && <>
                  <label className="text-xs text-slate-300 font-bold block">{role === 'guest' ? 'Invitation from host' : '2. Paste your friend’s reply'}
                    <textarea aria-label={role === 'guest' ? 'Host invitation' : 'Guest reply'} value={incomingCode} onChange={e => setIncomingCode(e.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl p-3 bg-slate-950 border border-slate-700 text-xs text-slate-200 font-mono" placeholder="Paste the complete KENTRO-LAN-1 code here" />
                  </label>
                  <button type="button" onClick={pasteFromClipboard} className="flex items-center justify-center gap-2 text-xs rounded-lg px-3 py-2 text-sky-300 border border-sky-500/20 hover:bg-sky-500/10"><Copy size={14}/> Paste from Clipboard</button>
                  <button disabled={busy || !incomingCode.trim()} onClick={role === 'guest' ? join : finishHost} className="w-full rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black py-3 disabled:opacity-40 text-sm">{busy ? 'Preparing connection…' : role === 'guest' ? '2. Create Reply' : '3. Connect & Start Game'}</button>
                </>}
                {role === 'guest' && !!answerCode && <p className="text-sm text-amber-300">2. Send the reply above to your host. Once they paste it, the game will start automatically.</p>}
                {role === 'host' && !offerCode && <p className="text-sm text-slate-400">{busy ? 'Preparing the offline invitation…' : 'No invitation was generated. Start pairing again to retry.'}</p>}
                <button onClick={reset} className="text-xs text-slate-400 hover:text-white underline">Start pairing again</button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_260px] gap-4">
            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-2 sm:p-4">
              <div className="flex justify-between items-center text-xs font-bold text-slate-300 p-2 gap-2"><span>{peerName} ({otherSide === 'W' ? 'White' : 'Black'})</span><span className="text-[10px] text-slate-500">{connected ? '● Connected' : '● Disconnected'}</span></div>
              <div className="aspect-square w-full max-w-[680px] mx-auto kentro-royal-frame">
                <div className="grid grid-cols-10 w-full h-full overflow-hidden select-none touch-manipulation kentro-royal-grid">
                {Array.from({ length: 100 }, (_, index) => {
                  const r = Math.floor(index / 10), c = index % 10;
                  const row = mySide === 'B' ? 9 - r : r;
                  const col = mySide === 'B' ? 9 - c : c;
                  const sq = ngRcToSq(row, col);
                  const piece = sq !== null ? match.board[sq] : null;
                  const isDark = sq !== null;
                  const selectedSq = sq !== null && selected === sq;
                  const destination = sq !== null && highlighted.has(sq);
                  const canSelect = isMyTurn && sq !== null && playable.has(sq);
                  return <button type="button" key={index} disabled={!isDark || !connected || !!match.result} onClick={() => sq !== null && clickSquare(sq)} aria-label={sq === null ? 'Light square' : `Square ${sq}${piece ? ` ${piece === piece.toUpperCase() ? 'king' : 'man'}` : ''}`} className={`relative flex items-center justify-center min-w-0 min-h-0 ${isDark ? 'kentro-wood-dark' : 'kentro-wood-light'} ${selectedSq ? 'ring-inset ring-[3px] ring-amber-300' : ''} ${destination ? 'ring-inset ring-[3px] ring-emerald-400' : ''} ${canSelect ? 'cursor-pointer' : 'cursor-default'}`}>
                    {piece && <span className={`kentro-royal-piece ${getCol(piece) === 'W' ? 'kentro-royal-piece--gold' : 'kentro-royal-piece--black'}`}>
                      {piece === piece.toUpperCase() && <span className="kentro-royal-king-mark"><Crown className="w-[60%] h-[60%] text-yellow-100 fill-amber-600 drop-shadow" /></span>}
                    </span>}
                    {destination && !piece && <span className="absolute w-[32%] h-[32%] bg-emerald-200 rounded-full opacity-90" />}
                    {isDark && <span className="absolute bottom-0 right-0 text-[7px] sm:text-[9px] text-white/40 px-0.5">{sq}</span>}
                  </button>;
                })}
                </div>
              </div>
              <div className="flex justify-between text-xs font-bold text-slate-300 p-2"><span>{localName || 'You'} ({mySide === 'W' ? 'White' : 'Black'} — You)</span><span>{match.history.length} moves</span></div>
            </div>
            <aside className="space-y-3">
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Game Status</p>
                <p className="text-base font-black mt-1">{match.result ? (match.result.winner ? (match.result.winner === mySide ? 'You win!' : 'Opponent wins') : 'Draw') : connected ? (match.turn === mySide ? 'Your turn' : 'Opponent’s turn') : 'Connection lost'}</p>
                {match.result && <p className="text-xs text-slate-400 mt-1">{match.result.reason}</p>}
                <p className="text-xs text-slate-400 mt-2">{notice}</p>
              </div>
              {drawIncoming && !match.result && <div className="bg-slate-900 border border-amber-500/40 rounded-xl p-3"><p className="text-xs mb-2">Your opponent offers a draw.</p><div className="flex gap-2"><button onClick={() => acceptDraw(true)} className="flex-1 bg-emerald-600 rounded-lg py-2 text-xs font-bold">Accept</button><button onClick={() => acceptDraw(false)} className="flex-1 bg-slate-700 rounded-lg py-2 text-xs">Decline</button></div></div>}
              {rematchIncoming && match.result && <div className="bg-slate-900 border border-emerald-500/40 rounded-xl p-3"><p className="text-xs mb-2">Opponent wants a rematch.</p><div className="flex gap-2"><button onClick={() => { if (send({ type: 'rematch-accept' })) restartGame(); }} className="flex-1 bg-emerald-600 rounded-lg py-2 text-xs font-bold">Accept</button><button onClick={() => { send({ type: 'rematch-decline' }); setRematchIncoming(false); }} className="flex-1 bg-slate-700 rounded-lg py-2 text-xs">Decline</button></div></div>}
              {!match.result ? <div className="space-y-2">
                <button disabled={!connected || drawOutgoing || drawIncoming} onClick={() => { if (send({ type: 'draw-offer' })) { setDrawOutgoing(true); setNotice('Waiting for draw response…'); } }} className="w-full flex gap-2 justify-center items-center p-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold"><Handshake size={16}/> {drawOutgoing ? 'Draw requested' : 'Offer Draw'}</button>
                <button disabled={!connected} onClick={() => { if (window.confirm('Resign this nearby game?')) { if (send({ type: 'resign' })) updateMatch({ ...matchRef.current, result: { winner: otherSide, reason: 'You resigned' } }); } }} className="w-full flex gap-2 justify-center items-center p-3 rounded-xl bg-slate-800 hover:bg-rose-950 text-rose-300 disabled:opacity-40 text-xs font-bold"><Flag size={16}/> Resign</button>
              </div> : <button disabled={!connected || rematchOutgoing} onClick={() => { if (send({ type: 'rematch-request' })) { setRematchOutgoing(true); setNotice('Waiting for opponent to accept rematch…'); } }} className="w-full flex gap-2 justify-center items-center p-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold"><RotateCcw size={16}/> {rematchOutgoing ? 'Rematch requested' : 'Play Again'}</button>}
              <button onClick={() => { if (window.confirm('Leave nearby match and disconnect?')) reset(); }} className="w-full text-xs font-bold rounded-xl p-3 border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center gap-2"><X size={14}/> Disconnect</button>
              <p className="text-[11px] text-slate-500">Offline games are private. They do not affect Kentro Coins, rankings or online match records.</p>
            </aside>
          </div>
        )}
        {!!error && <div role="alert" className="text-sm text-rose-300 bg-rose-950/60 border border-rose-600/40 rounded-xl p-3">{error}</div>}
        {!!notice && !showBoard && <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">{notice}</div>}
      </div>
    </div>
  );
}
