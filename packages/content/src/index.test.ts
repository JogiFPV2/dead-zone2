import { expect, it } from 'vitest';
import * as content from './index.js';

it('loads the placeholder module', () => {
  expect(content).toBeDefined();
});
