import assert from 'node:assert/strict';
import { canJoinOpenRoom, discoverChallenges, findQuickMatchRoom, isOwnRoom, QUICK_MATCH_TIMES } from '../src/lib/arenaDiscovery.ts';
const mk = (id, changes={}) => ({ id, creator:`Host${id}`, hostName:`Host${id}`,gameTime:5,specialRule:'none',wagerAmount:0,bestOf:1,playersCount:1,...changes });
const rooms = [
  mk('own',{hostName:'BAYO'}), mk('coin',{wagerAmount:50}), mk('series',{bestOf:3}),
  mk('special',{specialRule:'crown-crown'}), mk('occupied',{playersCount:2}),
  mk('10min',{gameTime:10}), mk('5min')
];
assert.deepEqual(QUICK_MATCH_TIMES,[3,5,10,15]);
assert.equal(isOwnRoom(rooms[0], 'bayo'),true);
assert.equal(canJoinOpenRoom(rooms[0],'bayo',false),false);
assert.equal(canJoinOpenRoom(rooms[1],'guest',true),false);
assert.equal(canJoinOpenRoom(rooms[2],'guest',true),false);
assert.equal(canJoinOpenRoom(rooms[4],'bayo',false),false);
assert.equal(findQuickMatchRoom(rooms,'bayo',false,5)?.id,'5min');
assert.equal(findQuickMatchRoom(rooms,'bayo',true,10)?.id,'10min');
assert.equal(findQuickMatchRoom(rooms,'bayo',true,3),undefined);
assert.deepEqual(discoverChallenges(rooms,'bayo',true,'standard').map(r=>r.id),['10min','5min']);
assert.deepEqual(discoverChallenges(rooms,'bayo',false,'all').map(r=>r.id),['coin','series','special','10min','5min']);
assert.deepEqual(discoverChallenges(rooms,'bayo',true,'free').map(r=>r.id),['special','10min','5min']);
console.log('PASS: 11 arena match discovery checks');
