import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteKenUnlock } from '../../src/server/kenUnlockPricing.ts';

// These tests run on Node 22 without npm dependencies or database access.
test('Ken 1-3 are free even if a legacy profile lists Ken 1', () => {
  assert.deepEqual(quoteKenUnlock(1,3,50,250),{level:3,cost:0,currentUnlocked:3});
});
test('Ken 3 to 4 costs one level and cannot be bought twice', () => {
  assert.equal(quoteKenUnlock(3,4,50,250).cost,50);
  assert.equal(quoteKenUnlock(4,4,50,250).cost,0);
});
test('Buying multiple locked levels pays for all those levels', () => {
  assert.equal(quoteKenUnlock(3,7,50,250).cost,200);
  assert.equal(quoteKenUnlock(5,8,50,250).cost,150);
});
test('Unlock all never costs more than buying the remaining levels individually', () => {
  assert.equal(quoteKenUnlock(3,'all',50,250).cost,250);
  assert.equal(quoteKenUnlock(7,'all',50,250).cost,50);
});
test('Quotes reject unsafe prices and bogus levels', () => {
  for (const level of [0,9,3.5,NaN]) assert.throws(()=>quoteKenUnlock(3,level,50,250));
  for (const cost of [-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>quoteKenUnlock(3,4,cost,250));
});
