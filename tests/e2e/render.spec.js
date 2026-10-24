// The renderer's focus rules, tested directly: a background re-render must keep
// the focused node itself (not a copy), never turn it into another control,
// and never blur it.
import { test, expect, open } from './helpers.js';

const offline = (page) => page.route('**/cloud-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.GYM_CLOUD_CONFIG = {};' }));

/** Renders `before`, focuses `focus`, renders `after`; reports what happened to the focused node. */
async function rerender(page, before, focus, after) {
  return page.evaluate(async ([b, f, a]) => {
    const { render, raw } = await import('/js/core/dom.js');
    const box = document.createElement('div');
    document.body.append(box);
    render(box, raw(b));
    const held = box.querySelector(f);
    held.focus();
    let blurs = 0;
    held.addEventListener('blur', () => blurs++);
    render(box, raw(a));
    const out = { same: document.activeElement === held && held.isConnected, blurs, text: held.textContent, focused: document.activeElement.textContent };
    box.remove();
    return out;
  }, [before, focus, after]);
}

test.beforeEach(async ({ page }) => { await offline(page); await open(page); });

test('an unkeyed element removed in front of the focused one does not disturb it', async ({ page }) => {
  expect(await rerender(page, '<span class="streak">3</span><button class="gear">Settings</button>', '.gear', '<button class="gear">Settings</button>'))
    .toMatchObject({ same: true, blurs: 0 });
});

test('a keyed element that goes away in front of an unkeyed one does not re-create it', async ({ page }) => {
  expect(await rerender(page, '<section data-key="danger">x</section><p class="about"><button data-privacy>Privacy</button></p>', '[data-privacy]', '<p class="about"><button data-privacy>Privacy</button></p>'))
    .toMatchObject({ same: true, blurs: 0 });
});

test('a control is never turned into a different one', async ({ page }) => {
  const r = await rerender(page, '<button data-share>Share</button><button data-delete>Delete</button>', '[data-share]', '<button data-delete>Delete</button>');
  // Either Share is still Share, or it is gone and focus moved openly.
  expect(r.same && r.text !== 'Share').toBe(false);
});

test('a keyed card that moves up keeps focus inside it without a blur', async ({ page }) => {
  expect(await rerender(page, '<div data-key="a">A</div><div data-key="b"><button>Going</button></div>', 'button', '<div data-key="b"><button>Going</button></div><div data-key="a">A</div>'))
    .toMatchObject({ same: true, blurs: 0 });
});

test('focus never falls back to a destructive control or the same action for another item', async ({ page }) => {
  const r = await rerender(page, '<div data-key="a"><button data-cancel-request="1">Cancel A</button></div><div data-key="b"><button data-cancel-request="2">Cancel B</button></div><div data-key="c"><button class="btn btn-danger">Delete</button></div><h2>List</h2>',
    '[data-cancel-request="1"]', '<div data-key="b"><button data-cancel-request="2">Cancel B</button></div><div data-key="c"><button class="btn btn-danger">Delete</button></div><h2>List</h2>');
  expect(['Cancel B', 'Delete']).not.toContain(r.focused);
});
