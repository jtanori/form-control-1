import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('testbed shell', () => {
  it('renders a heading', () => {
    expect(renderToStaticMarkup(createElement(App))).toContain('Voice Form Engine testbed');
  });
});
