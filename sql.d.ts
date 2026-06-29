// Vite/Vitest `?raw` imports — load a file's contents as a string.
// Used by integration tests to apply the real migration SQL (single source of
// truth) instead of re-declaring the schema inline.
declare module "*.sql?raw" {
  const content: string;
  export default content;
}
