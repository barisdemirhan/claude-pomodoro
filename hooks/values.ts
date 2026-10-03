// Readers for what the store hands back: JSON a session of any version of
// the mod wrote, so each value is taken only when it reads as its kind.

export const field = (value: object, key: string): unknown =>
  Object.entries(value).find(([name]) => name === key)?.[1]

export const isRecord = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A whole count of at least zero: 0 for anything else. */
export const toCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

export const toText = (value: unknown): string =>
  typeof value === 'string' ? value : ''

/** The strings of a list, each once and in their first order. */
export const toWords = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((word): word is string => typeof word === 'string' && word !== ''))]
    : []
