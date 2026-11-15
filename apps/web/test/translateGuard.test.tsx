// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { installTranslateGuard } from '../src/diagnostics/translateGuard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What a page translator does: every text node under `el` replaced by <font><font>translated</font></font>. */
function translate(el: Element) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    const outer = document.createElement('font');
    const inner = document.createElement('font');
    inner.textContent = `[es] ${t.data}`;
    outer.appendChild(inner);
    t.parentNode!.replaceChild(outer, t);
  }
}

/** A popup line beside text that comes and goes, as the terrain popup's VP note does. */
const Popup = ({ vp, extra }: { vp: boolean; extra: boolean }) => createElement('div', null, extra ? 'Extra ' : null, 'Open Ground', vp ? ' · VP hex' : null);

const mount = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(createElement(Popup, { vp: true, extra: false })));
  translate(el);
  return { el, root };
};

describe('a translated page (Google Translate swaps text nodes for <font>)', () => {
  it('without the guard, React throws when a translated text goes away', () => {
    const { root } = mount();
    expect(() => act(() => root.render(createElement(Popup, { vp: false, extra: false })))).toThrow(/removeChild|not a child/);
  });

  it('with the guard, text can be removed and inserted before a translated node, and the screen stays up', () => {
    installTranslateGuard();
    const { el, root } = mount();
    expect(() => act(() => root.render(createElement(Popup, { vp: false, extra: false })))).not.toThrow();
    expect(() => act(() => root.render(createElement(Popup, { vp: true, extra: true })))).not.toThrow();
    expect(el.textContent).toContain('Extra');
    expect(() => act(() => root.unmount())).not.toThrow();
  });
});
