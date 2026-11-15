import { describe, expect, it } from 'vitest';
import { getPresentationFitScale } from './presentationLayout';

describe('getPresentationFitScale', () => {
  it('fits a portrait slide to the available height when width alone would overflow', () => {
    expect(getPresentationFitScale(612, 792, 1000, 500)).toBeCloseTo(500 / 792);
  });

  it('fits a landscape slide to the available width', () => {
    expect(getPresentationFitScale(960, 540, 900, 600)).toBeCloseTo(900 / 960);
  });
});
