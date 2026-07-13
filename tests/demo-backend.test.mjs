import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key,value) { this.#values.set(key,String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

globalThis.window = globalThis;
globalThis.localStorage = new MemoryStorage();
globalThis.crypto ||= webcrypto;
globalThis.TSUKIMUSUBI_CONFIG = {};

await import('../backend.js');
const backend = globalThis.TsukiBackend;

assert.deepEqual(await backend.init(),{ mode: 'demo', context: null });
await backend.createPair({
  nameA: 'A',initialA: 'A',nameB: 'B',initialB: 'B',
  metDate: '2026-01-01',datingDate: '2026-02-01',
  codeA: 'AAAA-BBBB-CCCC-DDDD',codeB: 'EEEE-FFFF-GGGG-HHHH'
});
assert.equal(backend.context.entitlement.tier,'free');
assert.equal(backend.context.limits.photos,24);

for (let index=0;index<3;index+=1) {
  await backend.createMemory('anniversary',{ date: `2026-0${index+1}-01`,title: `記念日${index+1}`,note: '' });
}
await assert.rejects(
  () => backend.createMemory('anniversary',{ date: '2026-04-01',title: '上限',note: '' }),
  /quota/i
);

const scores = { communication: 8,trust: 8,care: 8,time: 8,support: 8,affection: 8 };
const words = { grateful: 'ありがとう',happy: '散歩',difficult: '忙しかった',hope: '旅行',selfChange: '話を聞く' };
await backend.submitReview('2026-07-01',{ scores,...words,renew: 'continue',questionPack: 'standard',extraAnswers: {} });
await backend.switchDemoRole('b');
await backend.submitReview('2026-07-01',{ scores,...words,renew: 'improve',questionPack: 'standard',extraAnswers: {} });
const reviews = await backend.loadReviews();
assert.equal(reviews.length,2);
assert.deepEqual(await backend.monthStatus('2026-07-01'),{ a: true,b: true });

await assert.rejects(
  () => backend.submitReview('2026-08-01',{ scores,...words,renew: 'continue',questionPack: 'future',extraAnswers: { next_season: '旅行' } }),
  /Plus membership required/i
);

console.log('demo backend checks passed');
