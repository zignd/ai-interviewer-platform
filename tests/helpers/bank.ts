import type { BankQuestion } from '@/lib/engine/types';

/** A small 8-topic bank, 2 questions per topic, mirroring the real seed shape. */
export function makeBank(topics = 8): BankQuestion[] {
  const bank: BankQuestion[] = [];
  for (let i = 0; i < topics; i++) {
    for (const category of ['behavioral', 'technical'] as const) {
      bank.push({
        id: `q-${i}-${category}`,
        topic: `topic_${i}`,
        category,
        text: `Question about topic ${i} (${category})`,
        difficulty: 2,
        followUpHints: [],
        priority: i * 10 + (category === 'technical' ? 1 : 0),
      });
    }
  }
  return bank;
}

/** Small deterministic PRNG so randomized tests are reproducible. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
