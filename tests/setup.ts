import { afterEach } from 'vitest';

// This file runs for every test, including the node-environment ones, so the
// DOM-only helpers are loaded lazily and only where a document actually exists.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
  const { cleanup } = await import('@testing-library/react');
  afterEach(cleanup);
}
