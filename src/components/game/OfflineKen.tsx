import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crown, Settings2, Volume2, VolumeX, WifiOff, RefreshCw } from 'lucide-react';
import { applyMove, captureClickTargets, checkGameEnd, createInitialBoard, generateLegalMoves, getCol, moveToHubString, moveToNotationString, resolveCaptureClick, type Move, type Piece } from '../../gameLogic';
import { offlineKenLevelMove } from '../../engine/offlineKen';
import { KEN_LEVELS } from '../../lib/constants';
import { safeStorage } from '../../lib/safeStorage';
import { playClickSound, playCaptureSound, playPromoSound } from '../../lib/audio';
import { BOARD_THEMES, type BoardTheme, type EngineEval, type PlayMode } from '../../types';
import { GameScreen } from './GameScreen';
import { GameSidebar } from '../panels/GameSidebar';
import { ComputerConfigModal } from '../modals/ComputerConfigModal';
import { SettingsModal } from '../modals/SettingsModal';
import { RulesModal } from '../modals/RulesModal';
import { AppGuideModal } from '../modals/AppGuideModal';
import { ResignConfirmModal } from '../modals/ResignConfirmModal';
import { GameOverModal } from '../modals/GameOverModal';
import { ModalShell } from '../ui/ModalShell';
import { OfflineReadyCard } from '../OfflineReadyCard';
import { InstallAppCard } from '../InstallAppCard';
const noop = () => {};
const emptyEval: EngineEval = {score:0,depth:0,pv:'',isThinking:false,ready:false};
export function OfflineKen({ onBack, initialLevel = 2, initialMode = 'Human_vs_AI', username = 'You' }: {
  onBack: () => void; initialLevel?: number; initialMode?: 'Human_vs_AI' | 'AI_vs_Human'; username?: string;
}) {
  const [history, setHistory] = useState<Move[]>([]);
  const [selected, setSelected] = useState<number|null>(null), [walked,setWalked] = useState<number[]>([]);
  const [configOpen,setConfigOpen] = useState(true), [settingsOpen,setSettingsOpen] = useState(false);
  const [rulesOpen,setRulesOpen] = useState(false), [guideOpen,setGuideOpen] = useState(false);
  const [readinessOpen,setReadinessOpen] = useState(false), [resignOpen,setResignOpen] = useState(false), [drawOpen,setDrawOpen] = useState(false);
  const [draftLevel,setDraftLevel] = useState(KEN_LEVELS.some(l=>l.id===initialLevel)?initialLevel:2), [draftMode,setDraftMode] = useState<PlayMode>(initialMode);
  const [session,setSession] = useState({level:draftLevel,mode:initialMode,serial:0,started:false,startedAt:0});
  const [thinking,setThinking] = useState(false), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  const [decision,setDecision] = useState<'resigned'|'draw'|null>(null), [resultDismissed,setResultDismissed] = useState(false);
  const [finishedAt,setFinishedAt] = useState<number|null>(null);
  const [reviewIndex,setReviewIndex] = useState<number|null>(null), [engineEval,setEngineEval] = useState<EngineEval>(emptyEval);
  const [isFlipped,setIsFlipped] = useState(initialMode==='AI_vs_Human'), [showNumbers,setShowNumbers] = useState(safeStorage.getItem('kentro_show_square_numbers')==='true');
  const [focusMode,setFocusMode] = useState(false), [muted,setMuted] = useState(safeStorage.getItem('lidraughts_muted')==='true');
  const [boardScale,setBoardScale] = useState(100), [reducedMotion,setReducedMotion] = useState(safeStorage.getItem('kentro_reduce_motion')==='true');
  const [theme,setTheme] = useState<BoardTheme>(()=>{const saved=safeStorage.getItem('lidraughts_board_theme');return saved&&saved in BOARD_THEMES?saved as BoardTheme:'wood';});
  const [light,setLight] = useState(safeStorage.getItem('lidraughts_custom_light')||'#f8fafc'), [dark,setDark] = useState(safeStorage.getItem('lidraughts_custom_dark')||'#1e293b'), [border,setBorder] = useState(safeStorage.getItem('lidraughts_custom_border')||'#0f172a');
  const [mobile,setMobile] = useState(window.innerWidth<1024);
  const layoutRef=useRef<HTMLElement>(null);
  const boardRef=useRef<HTMLDivElement>(null), requestRef=useRef<AbortController|null>(null);
  const board=useMemo(()=>history.reduce((b,m)=>applyMove(b,m).board,createInitialBoard()),[history]);
  const turn=history.length%2===0?'W':'B';
  const yourColor=session.mode==='AI_vs_Human'?'B':'W';
  const end=useMemo(()=>checkGameEnd(history),[history]);
  const gameOver=end.isOver||decision!==null;
  useEffect(()=>{setFinishedAt(previous=>gameOver?(previous??Date.now()):null);},[gameOver,session.serial]);
  const legal=useMemo(()=>generateLegalMoves(board,turn),[board,turn]);
  const candidates=legal.filter(m=>m.from===selected);
  const targets=captureClickTargets(candidates,walked);
  const visibleBoard=useMemo(()=>reviewIndex===null?board:history.slice(0,reviewIndex+1).reduce((b,m)=>applyMove(b,m).board,createInitialBoard()),[board,history,reviewIndex]);
  const stats=useMemo(()=>{const pieces=Object.values(board);return {whitePieces:pieces.filter(p=>p?.toLowerCase()==='w').length,blackPieces:pieces.filter(p=>p?.toLowerCase()==='b').length,whiteKings:pieces.filter(p=>p==='W').length,blackKings:pieces.filter(p=>p==='B').length};},[board]);
  const cancel = () => { requestRef.current?.abort(); requestRef.current=null; setThinking(false); };
  useEffect(()=>{const resize=()=>setMobile(window.innerWidth<1024);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
  useEffect(()=>{safeStorage.setItem('lidraughts_board_theme',theme);safeStorage.setItem('lidraughts_muted',String(muted));safeStorage.setItem('kentro_show_square_numbers',String(showNumbers));safeStorage.setItem('kentro_reduce_motion',String(reducedMotion));safeStorage.setItem('lidraughts_custom_light',light);safeStorage.setItem('lidraughts_custom_dark',dark);safeStorage.setItem('lidraughts_custom_border',border);},[theme,muted,showNumbers,reducedMotion,light,dark,border]);
  useEffect(()=>{
    const screen=layoutRef.current?.querySelector<HTMLElement>('.k-match-screen');
    const stage=screen?.querySelector<HTMLElement>('.k-match-stage');
    if(!screen||!stage)return;
    let frame=0;
    const measure=()=>{
      const style=getComputedStyle(screen), stageStyle=getComputedStyle(stage);
      const flow=Array.from(screen.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&getComputedStyle(node).display!=='none'&&!['fixed','absolute'].includes(getComputedStyle(node).position));
      const siblings=flow.filter(node=>node!==stage).reduce((sum,node)=>{const css=getComputedStyle(node);return sum+node.getBoundingClientRect().height+(parseFloat(css.marginTop)||0)+(parseFloat(css.marginBottom)||0);},0);
      const padding=(parseFloat(style.paddingTop)||0)+(parseFloat(style.paddingBottom)||0);
      const margins=(parseFloat(stageStyle.marginTop)||0)+(parseFloat(stageStyle.marginBottom)||0);
      const gap=(parseFloat(style.rowGap)||0)*Math.max(0,flow.length-1);
      const width=screen.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
      const size=Math.floor(Math.max(160,Math.min(680,width,screen.clientHeight-padding-margins-gap-siblings)));
      const value=`${size}px`;if(screen.style.getPropertyValue('--offline-board-size')!==value)screen.style.setProperty('--offline-board-size',value);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(screen);
    Array.from(screen.children).forEach(node=>{if(node!==stage&&node instanceof HTMLElement&&getComputedStyle(node).position!=='fixed')observer.observe(node);});
    schedule();return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[mobile,focusMode]);
  const sound = (move:Move) => {const next=applyMove(board,move).board; if(board[move.from]!==next[move.to])playPromoSound(muted);else if(move.caps.length)playCaptureSound(muted);else playClickSound(muted);};
  useEffect(()=>{
    requestRef.current?.abort(); requestRef.current=null; setThinking(false); setError('');
    if(!session.started||configOpen||gameOver||reviewIndex!==null||turn===yourColor) return ()=>requestRef.current?.abort();
    const controller=new AbortController();requestRef.current=controller;setThinking(true);
    offlineKenLevelMove(board,turn,session.level,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      if(!result.move)throw new Error('Ken did not return a move. Retry the engine.');
      sound(result.move);setSelected(null);setWalked([]);setEngineEval(emptyEval);setHistory(previous=>[...previous,result.move!]);
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Ken could not complete the move.');})
    .finally(()=>{if(requestRef.current===controller){requestRef.current=null;setThinking(false);}});
    return ()=>{controller.abort();if(requestRef.current===controller)requestRef.current=null;};
  },[board,turn,session,configOpen,gameOver,reviewIndex,retry]);
  const start = (level=draftLevel,mode=draftMode) => {cancel();setDraftLevel(level);setDraftMode(mode);setSession({level,mode:mode==='AI_vs_Human'?'AI_vs_Human':'Human_vs_AI',serial:session.serial+1,started:true,startedAt:Date.now()});setHistory([]);setSelected(null);setWalked([]);setReviewIndex(null);setDecision(null);setResultDismissed(false);setEngineEval(emptyEval);setIsFlipped(mode==='AI_vs_Human');setConfigOpen(false);};
  const openSetup = () => {cancel();setDraftLevel(session.level);setDraftMode(session.mode);setConfigOpen(true);};
  const click = (sq:number) => {
    if(!session.started||configOpen||gameOver||reviewIndex!==null||turn!==yourColor)return;
    const result=resolveCaptureClick(candidates,walked,sq);
    if(result.kind==='apply'){cancel();sound(result.move);setEngineEval(emptyEval);setHistory(previous=>[...previous,result.move]);setSelected(null);setWalked([]);}
    else if(result.kind==='extend')setWalked(result.walked);
    else if(getCol(board[sq])===yourColor){setSelected(sq);setWalked([]);}
  };
  const navigate = (index:number) => {cancel();setEngineEval(emptyEval);setSelected(null);setWalked([]);setReviewIndex(Math.max(-1,Math.min(index,history.length-1)));};
  const undo = () => {if(!history.length)return;cancel();setHistory(previous=>previous.slice(0,Math.max(yourColor==='B'?1:0,previous.length-(turn===yourColor?2:1))));setSelected(null);setWalked([]);setReviewIndex(null);setDecision(null);setResultDismissed(false);setEngineEval(emptyEval);};
  const hint = async () => {
    if(thinking||gameOver||reviewIndex!==null||turn!==yourColor)return;
    cancel();const controller=new AbortController();requestRef.current=controller;setThinking(true);setError('');
    try{const result=await offlineKenLevelMove(board,turn,8,controller.signal);if(!controller.signal.aborted&&result.move)setEngineEval({score:result.score,depth:result.depth,pv:moveToHubString(result.move),turn,isThinking:false,ready:true});}
    catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Hint unavailable.');}
    finally{if(requestRef.current===controller){requestRef.current=null;setThinking(false);}}
  };
  const outcome=decision==='draw'||end.isDraw?'draw':decision==='resigned'||end.winner!==yourColor?'loss':'win';
  const status=!session.started?'Choose your side and difficulty':gameOver?(outcome==='draw'?'Draw':outcome==='win'?'You win':'Ken wins'):reviewIndex!==null?'Reviewing your game':thinking?(turn===yourColor?'Finding a hint…':'Ken is thinking…'):turn===yourColor?`Your turn — ${yourColor==='W'?'Gold':'Black'}`:'Ken to move';
  const boardSidebar=<GameSidebar isComputerMode isEditorMode={false} clock={null} turn={turn} clockLimitType="Untimed" activePuzzleId={null} moveHistory={history} moveHistoryStrings={history.map(moveToNotationString)} historyViewIndex={reviewIndex} onHistoryNavigate={navigate} onContinueFromHistory={()=>{if(reviewIndex!==null){cancel();setHistory(history.slice(0,reviewIndex+1));setReviewIndex(null);setDecision(null);setResultDismissed(false);setEngineEval(emptyEval);}}} onResetHistoryView={()=>setReviewIndex(null)}/>;
  const whiteName=yourColor==='W'?'You':`Ken ${session.level}`,blackName=yourColor==='B'?'You':`Ken ${session.level}`;
  const gameProps: React.ComponentProps<typeof GameScreen> = {
    offlinePractice:true,playMode:session.mode,roomId:null,multiplayerStarted:false,multiplayerGameTime:0,multiplayerSpecialRule:'',copiedRoomCode:false,setCopiedRoomCode:noop,ws:null,
    handleModeChange:()=>{cancel();onBack();},isComputerMode:true,setShowComputerConfigModal:value=>{if(typeof value==='function'?value(configOpen):value)openSetup();else setConfigOpen(false);},kenLevelId:session.level,isThinking:thinking,turn,statusMessage:status,stats,activePuzzleId:null,clockLimitType:'Untimed',clock:null,isMobile:mobile,boardScale,focusMode,setFocusMode,engineEval,isFlipped,setIsFlipped,isEditorMode:false,boardTheme:theme,activeThemeColors:BOARD_THEMES[theme],customBorder:border,customDarkSquare:dark,customLightSquare:light,boardArenaRef:boardRef,floatingEmojis:[],displayRows:isFlipped?[9,8,7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7,8,9],displayCols:isFlipped?[9,8,7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7,8,9],showSquareNumbers:showNumbers,setShowSquareNumbers:setShowNumbers,renderBoard:visibleBoard,capturedAnimations:[],selectedSq:selected,selectedDestSquares:targets,capturingSquares:new Map([...targets].filter(()=>candidates.some(m=>m.caps.length)).map(sq=>[sq,1])),lastMove:reviewIndex===null?history.at(-1)||null:history[reviewIndex]||null,handleSquareClick:click,historyViewIndex:reviewIndex,handleResetHistoryView:()=>setReviewIndex(null),moveEvaluations:{},drawOfferReceived:null,handleDrawResponse:noop,moveHistory:history,drawOfferSent:false,handleOfferDraw:()=>setDrawOpen(true),handleResign:()=>setResignOpen(true),resignOfferReceived:null,handleResignResponse:noop,resignOfferSent:false,handleNewGame:openSetup,handleUndo:undo,handleSuggestMove:()=>void hint(),editorSelectedPiece:'w' as Piece,setEditorSelectedPiece:noop,editorTurn:'W',setEditorTurn:noop,handleClearBoard:noop,handleStartSandboxMatch:noop,sidebarContent:boardSidebar,onOpenMobileChat:null,unreadRoomChat:0,puzzleArrowSquares:null,onExitPuzzles:null,opponentAway:null,yourColor,whiteName,blackName,moveHistoryStrings:history.map(moveToNotationString),onHistoryNavigate:navigate,onOpenRules:()=>setRulesOpen(true),onOpenAppGuide:()=>setGuideOpen(true),onOpenSettings:()=>setSettingsOpen(true),obligatoryCaptureSquares:legal[0]?.caps.length?new Set(legal.map(m=>m.from)):new Set(),
  };
  return <div className={`k-offline-match h-dvh flex flex-col bg-slate-950 text-slate-100 ${reducedMotion?'k-reduced-motion':''} ${focusMode?'k-focus-active':''}`}>
    <header className="k-global-topnav"><button className="k-brand" onClick={()=>{cancel();onBack();}}><span className="k-brand-symbol"><Crown size={20}/></span>KENTRO DRAUGHTS</button><h1 className="text-sm font-bold sm:text-base">Play vs Ken · Offline</h1><div className="k-global-right"><InstallAppCard variant="compact"/><button className="k-nav-icon k-offline-sound" aria-label={muted?'Enable sound':'Mute sound'} onClick={()=>setMuted(!muted)}>{muted?<VolumeX size={19}/>:<Volume2 size={19}/>}</button><button className="k-nav-icon" aria-label="Settings" onClick={()=>setSettingsOpen(true)}><Settings2 size={19}/></button></div></header>
    <div className="k-offline-note"><WifiOff size={13}/><span>Offline practice · Untimed · Ken {session.level}</span><button onClick={()=>setReadinessOpen(true)}>Offline files</button></div>
    {error&&<div className="flex flex-wrap items-center justify-center gap-3 bg-amber-950/50 p-2 text-sm text-amber-200" role="alert"><span>{error}</span><button className="underline flex items-center gap-1" onClick={()=>turn===yourColor?void hint():setRetry(n=>n+1)}><RefreshCw size={14}/>Retry engine</button></div>}
    <div className="flex flex-1 min-h-0"><main ref={layoutRef} className="flex flex-1 min-w-0 min-h-0"><GameScreen {...gameProps}/></main>{!focusMode&&<aside className="hidden lg:flex w-80 flex-col gap-3 border-l border-slate-800 p-4 overflow-y-auto"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">Draughts Arena Desk</h2>{boardSidebar}<p className="text-xs text-slate-300">Local practice. Online ratings, coins and level unlocks are unchanged.</p></aside>}</div>
    <ComputerConfigModal offlinePractice open={configOpen} onClose={()=>session.started?setConfigOpen(false):onBack()} coinBalance={0} profileStats={{username,elo:1500,maxUnlockedKenLevel:8,wins:0,losses:0,draws:0,gamesCount:0,totalPlayTime:0,averageDuration:0}} coinSettings={null} kenLevelId={draftLevel} setKenLevelId={setDraftLevel} setStatusMessage={setError} muted={muted} playMode={draftMode} setPlayMode={setDraftMode} purchaseSubmitted={false} onUnlockKenLevel={noop} onOpenStore={noop} onApplyStart={()=>start()}/>
    <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} muted={muted} setMuted={setMuted} showSquareNumbers={showNumbers} setShowSquareNumbers={setShowNumbers} boardTheme={theme} setBoardTheme={setTheme} customLightSquare={light} setCustomLightSquare={setLight} customDarkSquare={dark} setCustomDarkSquare={setDark} customBorder={border} setCustomBorder={setBorder} boardScale={boardScale} setBoardScale={setBoardScale} focusMode={focusMode} setFocusMode={setFocusMode} reducedMotion={reducedMotion} setReducedMotion={setReducedMotion}/>
    <RulesModal open={rulesOpen} onClose={()=>setRulesOpen(false)}/><AppGuideModal open={guideOpen} onClose={()=>setGuideOpen(false)}/>
    <ModalShell open={readinessOpen} onClose={()=>setReadinessOpen(false)} title="Offline files" size="sm"><OfflineReadyCard/></ModalShell>
    <ResignConfirmModal open={resignOpen} onClose={()=>setResignOpen(false)} onConfirmResign={()=>{cancel();setDecision('resigned');setResignOpen(false);}}/>
    <ModalShell open={drawOpen} onClose={()=>setDrawOpen(false)} title="End this practice as a draw?" size="sm"><p className="text-sm text-slate-300">This ends the local game with a draw.</p><button className="k-button k-button-main mt-4" onClick={()=>{cancel();setDecision('draw');setDrawOpen(false);}}>Confirm draw</button></ModalShell>
    <GameOverModal open={gameOver&&!resultDismissed} outcome={outcome} player1="You" player2={`Ken ${session.level}`} movesCount={history.length} durationSeconds={session.started?Math.max(0,Math.floor(((finishedAt??Date.now())-session.startedAt)/1000)):0} resultReason={decision==='resigned'?'You resigned':decision==='draw'?'Practice draw':end.reason} onRematch={()=>start(session.level,session.mode)} onBackToLobby={onBack} onViewReplay={()=>{setResultDismissed(true);navigate(-1);}} canLevelUp={false}/>
  </div>;
}
