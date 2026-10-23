import { describe, expect, it } from 'vitest';
import { tokenizeAktrCodes } from './aktrCodeInput';

describe('tokenizeAktrCodes', () => {
  it('returns an empty array for empty, whitespace, or separator-only inputs', () => {
    expect(tokenizeAktrCodes('')).toEqual([]);
    expect(tokenizeAktrCodes('   \t  \n  ')).toEqual([]);
    expect(tokenizeAktrCodes(' , ; ,,, ;;; ')).toEqual([]);
  });

  it('splits codes on whitespace, commas, and semicolons', () => {
    const input = 'PA.I.A.K1, PA.I.B.K1; PA.II.A.K1   PA.II.B.K1';
    expect(tokenizeAktrCodes(input)).toEqual([
      'PA.I.A.K1',
      'PA.I.B.K1',
      'PA.II.A.K1',
      'PA.II.B.K1',
    ]);
  });

  it('trims tokens and normalizes ASCII letters to uppercase', () => {
    const input = '  pa.i.a.k1 ,  ir.ii.b.k2 ; ca.iii.c.k3  ';
    expect(tokenizeAktrCodes(input)).toEqual([
      'PA.I.A.K1',
      'IR.II.B.K2',
      'CA.III.C.K3',
    ]);
  });

  it('does not change non-ASCII letters while normalizing ASCII letters', () => {
    expect(tokenizeAktrCodes('café straße')).toEqual(['CAFé', 'STRAßE']);
  });

  it('keeps first-seen order and deduplicates normalized tokens', () => {
    const input = 'PA.I.A.K1, pa.i.a.k1; PA.II.A.K1, PA.I.A.K1, PA.II.A.k1, PA.III.A.K1';
    expect(tokenizeAktrCodes(input)).toEqual([
      'PA.I.A.K1',
      'PA.II.A.K1',
      'PA.III.A.K1',
    ]);
  });

  it('preserves unknown, legacy, or oddly shaped tokens without discarding them', () => {
    // Slice 1 has no authoritative catalog; must preserve every non-empty token
    const input = 'PA.I.A.K1, PLT123, ???, 12345, RANDOM-TOKEN, PLT040';
    expect(tokenizeAktrCodes(input)).toEqual([
      'PA.I.A.K1',
      'PLT123',
      '???',
      '12345',
      'RANDOM-TOKEN',
      'PLT040',
    ]);
  });

  it('handles mixed punctuation delimiters cleanly', () => {
    const input = ';;,,   PA.I.A.K1,;,,PA.I.B.K1   ;;';
    expect(tokenizeAktrCodes(input)).toEqual(['PA.I.A.K1', 'PA.I.B.K1']);
  });
});
