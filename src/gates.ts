export const GATES = ['complexity', 'crap', 'duplication'] as const;
export type Gate = (typeof GATES)[number];
