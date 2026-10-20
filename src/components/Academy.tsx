import React,{useEffect,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,CheckCircle2,GraduationCap,RotateCcw,Sparkles} from 'lucide-react';
import {ACADEMY_LESSONS,lessonMoves} from '../lib/academy';
import {applyMove,moveToNotationString,type Move} from '../gameLogic';
import {safeStorage} from '../lib/safeStorage';
import {BoardReplay} from './TVBoard';
export function Academy({ownerId,onHome,onPuzzles,onPlay}:{ownerId?:string;onHome:()=>void;onPuzzles:()=>void;onPlay:()=>void}){
 const key=`kentro.academy.v1.${ownerId||'guest'}`;
 const read=()=>{try{const p=JSON.parse(safeStorage.getItem(key)||'[]');return Array.isArray(p)?p.filter(id=>ACADEMY_LESSONS.some(l=>l.id===id)):[];}catch{return [];}};
 const [done,setDone]=useState<string[]>(read),[index,setIndex]=useState(0),[answer,setAnswer]=useState<number|null>(null),[attempt,setAttempt]=useState<{lessonId:string;move:Move}|null>(null),[selected,setSelected]=useState<number|null>(null),[message,setMessage]=useState('');
 useEffect(()=>{setDone(read());setIndex(0);},[key]);
 const lesson=ACADEMY_LESSONS[index],legal=lessonMoves(lesson),correct=answer===lesson.correct;
 const move=attempt?.lessonId===lesson.id?attempt.move:null;
 const setMove=(value:Move|null)=>setAttempt(value?{lessonId:lesson.id,move:value}:null);
 const reset=()=>{setAnswer(null);setMove(null);setSelected(null);setMessage('');};
 useEffect(reset,[index,key]);
 const chooseLesson=(next:number)=>{reset();setIndex(next);};
 const play=(candidate:Move)=>{if(!lesson.accept(candidate)){setMessage('That is a legal move, but this exercise asks for a different goal. Try another route.');return;}setMove(candidate);setSelected(null);setMessage('Well played. You completed the exercise.');};
 const complete=()=>{const next=[...new Set([...done,lesson.id])];safeStorage.setItem(key,JSON.stringify(next));setDone(next);setMessage(safeStorage.getItem(key)===JSON.stringify(next)?'Lesson completed. Progress saved on this device.':'Lesson completed for this visit. Browser storage is unavailable.');};
 return <section className="k-academy-page"><div className="k-academy-shell"><header className="k-academy-header"><div><span className="k-overline">LEARN THE GAME. SEE THE PATTERN.</span><h1><GraduationCap size={28}/> Kentro Academy</h1><p>Six practical lessons in Nigerian draughts, using the rules you play.</p></div><button className="k-button k-button-outline" onClick={onHome}><ArrowLeft size={16}/> Home</button></header>
 <div className="k-academy-progress"><span><CheckCircle2 size={17}/> {done.length} of {ACADEMY_LESSONS.length} lessons complete</span><progress aria-label="Academy lesson progress" value={done.length} max={ACADEMY_LESSONS.length}/><small>Progress is saved on this device{ownerId?' for your account':'. Sign in to keep account progress separate'}.</small></div>
 <div className="k-academy-layout"><nav aria-label="Academy lessons" className="k-academy-lessons">{ACADEMY_LESSONS.map((l,i)=><button key={l.id} aria-current={i===index?'step':undefined} className={i===index?'active':''} onClick={()=>chooseLesson(i)}><span className="k-lesson-number">{done.includes(l.id)?<CheckCircle2 size={17}/>:String(i+1).padStart(2,'0')}</span><span><strong>{l.title}</strong><small>{l.subtitle}</small></span></button>)}</nav>
 <article className="k-academy-study"><div className="k-section-heading"><div><span className="k-overline">LESSON {index+1} / {ACADEMY_LESSONS.length}</span><h2>{lesson.title}</h2></div><button onClick={reset} className="k-small-action"><RotateCcw size={14}/> Reset</button></div><p className="k-lesson-body">{lesson.body}</p>
 <fieldset className="k-lesson-question"><legend>{lesson.question}</legend>{lesson.answers.map((text,i)=><button aria-pressed={answer===i} key={text} className={answer===i?(correct?'correct':'retry'):''} onClick={()=>{setAnswer(i);setMove(null);setSelected(null);setMessage(i===lesson.correct?lesson.explanation:'Try again. Read the lesson, then choose another answer.');}}>{text}</button>)}</fieldset>
 <p role="status" aria-live="polite" className="k-lesson-feedback">{message}</p>
 {correct&&<div className="k-lesson-practice"><h3><Sparkles size={17}/> Try it on the board</h3><p>{lesson.goal}</p><div className="k-lesson-board"><BoardReplay showNumbers board={move?applyMove(lesson.board,move).board:lesson.board} lastMove={move||(selected?{from:selected,to:selected}:null)} onSquare={!move?square=>{const choices=legal.filter(m=>m.from===selected&&m.to===square);if(choices.length===1){play(choices[0]);}else if(choices.length>1){setMessage('Choose the complete capture route from the moves below.');}else if(legal.some(m=>m.from===square)){setSelected(square);setMessage('Piece selected. Choose a landing square or a move below.');}else{setMessage('Select a movable White piece, then its landing square.');}}:undefined}/></div>
 {!move&&<div className="k-lesson-moves" aria-label="Legal exercise moves">{legal.map((m,i)=><button key={i} onClick={()=>play(m)}>{moveToNotationString(m)}</button>)}</div>}
 {move&&<button className="k-button k-button-main" onClick={complete}><CheckCircle2 size={17}/>{done.includes(lesson.id)?'Save completion again':'Complete lesson'}</button>}
 </div>}
 <footer className="k-lesson-footer"><button className="k-button k-button-outline" disabled={index===0} onClick={()=>chooseLesson(index-1)}><ArrowLeft size={15}/> Previous</button>{index<ACADEMY_LESSONS.length-1?<button className="k-button k-button-outline" onClick={()=>chooseLesson(index+1)}>Next lesson <ArrowRight size={15}/></button>:<button className="k-button k-button-main" onClick={onPuzzles}>Explore puzzles <ArrowRight size={15}/></button>}</footer>
 </article></div>
 <section className="k-academy-next"><BookOpen size={24}/><div><h2>Take your next step.</h2><p>Practise against Ken, solve a combination, or return to a lesson whenever you need it.</p></div><button className="k-button k-button-outline" onClick={onPlay}>Play vs Ken</button><button className="k-button k-button-main" onClick={onPuzzles}>Find a puzzle <ArrowRight size={16}/></button></section>
 </div></section>;
}
