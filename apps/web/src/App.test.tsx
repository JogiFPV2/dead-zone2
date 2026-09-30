import { expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { App } from './App.js';

it('renders the title and tagline', () => {
  const html = renderToString(<App />);
  expect(html).toContain('Deadzone');
  expect(html).toContain('Przeżyj');
});
