import { expect, it } from 'vite-plus/test';
import { sign } from './sign.ts';

it('tells the sign of a number', () => {
  expect(sign(-1)).toBe('negative');
  expect(sign(0)).toBe('positive');
});
