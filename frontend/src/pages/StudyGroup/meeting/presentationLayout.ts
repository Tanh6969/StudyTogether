export function getPresentationFitScale(
  pageWidth: number,
  pageHeight: number,
  containerWidth: number,
  containerHeight: number
): number {
  if (pageWidth <= 0 || pageHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) return 1;
  return Math.min(containerWidth / pageWidth, containerHeight / pageHeight);
}
