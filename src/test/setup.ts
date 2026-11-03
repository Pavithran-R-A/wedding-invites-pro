import "@testing-library/jest-dom";

// `matchMedia` is a shim for the environments that have a window. The suite is not entirely made of
// those: `src/test/pagesWorkerRouting.test.ts` runs under `@vitest-environment node`, because the code
// it drives is an edge Worker that will never see a DOM, and a test for it should not borrow a browser
// to get one. The guard therefore protects the shim rather than the assertion — an unconditional
// `Object.defineProperty(window, …)` failed the whole node-env file at collection time, before any
// expectation ran, which is the worst kind of red because it looks like a product failure.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
