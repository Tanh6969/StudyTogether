import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia -- UI libraries (e.g. Excalidraw) query color-scheme /
// reduced-motion at module load time, so tests importing them fail without this stub.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
