import {describe,it,expect} from 'vitest';
import {ACADEMY_LESSONS,lessonMoves} from './academy';
import {applyMove,generateLegalMoves,checkGameEnd} from '../gameLogic';
describe('Nigerian Academy studies',()=>{
 it.each(ACADEMY_LESSONS)('$id has a valid answer and a legal exercise goal',lesson=>{expect(lesson.answers[lesson.correct]).toBeTruthy();const legal=lessonMoves(lesson);expect(legal.length).toBeGreaterThan(0);expect(legal.some(lesson.accept)).toBe(true);});
 it('demonstrates different complete capture lengths under free-choice rules',()=>{const lesson=ACADEMY_LESSONS.find(l=>l.id==='choice')!;expect(new Set(lessonMoves(lesson).map(m=>m.caps.length))).toEqual(new Set([1,2]));});
 it('proves the introductory combination against every defensive reply',()=>{const root=ACADEMY_LESSONS.find(l=>l.id==='combination')!,first=lessonMoves(root).find(root.accept)!;const secondBoard=applyMove(root.board,first).board;const replies=generateLegalMoves(secondBoard,'B');expect(replies.length).toBeGreaterThan(0);for(const reply of replies){const next=applyMove(secondBoard,reply).board;expect(reply.caps.length).toBeGreaterThan(0);const wins=generateLegalMoves(next,'W').filter(last=>{const result=checkGameEnd([first,reply,last],root.board,root.turn);return result.isOver&&!result.isDraw&&result.winner==='W';});expect(wins.length).toBeGreaterThan(0);}});
});
