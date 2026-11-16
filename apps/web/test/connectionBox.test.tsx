// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConnectionBox } from '../src/panels/ConnectionBox';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('the Connection Location panel (S70 SSR 2)', () => {
  it('lists an advance it may not make greyed out, with the reason (a full Cave, ASLRB G11.4), beside one it may', () => {
    const host = document.createElement('div');
    root = createRoot(host);
    act(() =>
      root!.render(
        createElement(ConnectionBox, {
          units: [{ id: 'a', label: 'Japanese 4-4-7' }],
          selected: false,
          onSelect: () => {},
          actions: [
            { label: 'Advance into the Cave in V7', run: () => {}, disabled: true, hint: 'Stacking limit: 1 squad-equivalents' },
            { label: 'Advance into the Cave in X3', run: () => {} },
          ],
        }),
      ),
    );
    const buttons = [...host.querySelectorAll('button')].filter((b) => b.textContent?.startsWith('Advance'));
    expect(buttons.map((b) => [b.textContent, b.disabled])).toEqual([
      ['Advance into the Cave in V7', true],
      ['Advance into the Cave in X3', false],
    ]);
    expect(host.textContent).toContain('Advance into the Cave in V7: Stacking limit: 1 squad-equivalents');
  });
});
