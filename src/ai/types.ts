export const Move = {
  Rock: 'r',
  Paper: 'p',
  Scissors: 's',
  // Enemy made move, but it still not visible for ai, before round ended
  Hidden: 'h',
} as const

export type Move = (typeof Move)[keyof typeof Move]

export type Round = [Move | null, Move | null]
