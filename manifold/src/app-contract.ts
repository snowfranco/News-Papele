// The single source of truth for the Superlearn contract.
//
// manifold imports the app's REAL schemas and types from src/, never a
// vendored copy. A schema change is now one edit in one place and drift is
// impossible: extend src/types.ts + src/schemas.ts and manifold sees it at
// once (AGENTS.md architecture rules; docs/adr/0001-manifold-runtime.md).
//
// Path note: the app's src/schemas.ts imports './types' with no file
// extension, which Node's native TypeScript loader and Deno both reject.
// Only an esbuild-based resolver (tsx at runtime, vitest in tests) accepts
// it, which is the reason manifold runs on Node via tsx rather than in an
// Edge/Deno runtime (docs/adr/0001-manifold-runtime.md, the runner-up
// section). This barrel is the one place the '../../src' path lives; every
// other manifold module imports the contract from here.
export * from '../../src/schemas.ts';
export * from '../../src/types.ts';
