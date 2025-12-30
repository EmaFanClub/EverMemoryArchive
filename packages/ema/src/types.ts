/**
 * Type checking utilities.
 */
/**
 * Check if A is a subtype of B.
 */
export type Is<A, B> = A extends B ? true : false;
/**
 * Check if A and B are equal.
 */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
/**
 * Expect T to be true.
 */
export type Expect<T extends true> = Equal<T, true>;
