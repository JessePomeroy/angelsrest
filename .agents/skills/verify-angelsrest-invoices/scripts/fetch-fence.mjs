const allowedOrigins = new Set([
  'https://adjoining-iguana-707.convex.cloud',
  'https://adjoining-iguana-707.convex.site',
  'https://api.stripe.com',
  'http://127.0.0.1:5198',
]);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (!allowedOrigins.has(url.origin)) {
    throw new Error(`Invoice verification blocked outbound fetch to ${url.origin}`);
  }
  return nativeFetch(input, init);
};
