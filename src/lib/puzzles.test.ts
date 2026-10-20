import {beforeEach,it,expect,vi} from 'vitest';
import {getSolvedPuzzleIds,markPuzzleSolved,currentPuzzleWeekKey} from './puzzles';
const values=new Map<string,string>();
beforeEach(()=>{values.clear();vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k),key:(i:number)=>[...values.keys()][i],get length(){return values.size;}});});
it('isolates weekly puzzle progress by account and guest',()=>{markPuzzleSolved('alice-puzzle','alice');markPuzzleSolved('guest-puzzle');expect([...getSolvedPuzzleIds('alice')]).toEqual(['alice-puzzle']);expect(getSolvedPuzzleIds('bob').size).toBe(0);expect([...getSolvedPuzzleIds()]).toEqual(['guest-puzzle']);});
it('does not assign unattributed legacy progress to a newly signed-in player',()=>{values.set(currentPuzzleWeekKey(),JSON.stringify(['legacy']));expect(getSolvedPuzzleIds('alice').size).toBe(0);markPuzzleSolved('new','alice');expect(values.get(currentPuzzleWeekKey())).toContain('legacy');});
