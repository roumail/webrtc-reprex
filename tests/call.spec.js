// Feature: an audio call between two devices on the same Wi-Fi, set up by
// copy-paste (no server).
//
// Cast (see README.md):
//   docs/          the code under test: the call page
//   two contexts   two devices: "Mac" calls, "iPhone" answers. Each gets
//                  its own fresh browser context, like two separate phones
//   the test       plays the person copying text between them, which is
//                  what the relay will do later (call_offer / call_answer)
//
// App <-> test contract: data-state on <main> (idle, preparing,
// waiting-for-answer, connecting, connected, ended, failed), the test ids
// below (incl. start-over), data-bytes-received on the stats line, the log.
// Tests wait on state, never on time.
const { test, expect } = require('@playwright/test');

async function device(browser, name) {
  const context = await browser.newContext({ permissions: ['microphone'] });
  // The environment, not the app: lets a test hide the page like locking
  // the phone or switching apps does.
  await context.addInitScript(() => {
    let state = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => state });
    Object.defineProperty(document, 'hidden', { get: () => state === 'hidden' });
    window.__setVisibility = (next) => {
      state = next;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  const page = await context.newPage();
  await page.goto('./');
  await expect(page.locator('main')).toHaveAttribute('data-state', 'idle');
  return { name, page, main: page.locator('main') };
}

// Copies what one side shows into the other side, like the person would.
async function carry(from, to) {
  const text = await from.page.getByTestId('outgoing').inputValue();
  expect(text).not.toBe('');
  await to.page.getByTestId('incoming').fill(text);
  await to.page.getByTestId('use').click();
}

async function connectedCall(browser) {
  const mac = await device(browser, 'Mac');
  const iphone = await device(browser, 'iPhone');
  await mac.page.getByTestId('call').click();
  await expect(mac.main).toHaveAttribute('data-state', 'waiting-for-answer');
  await carry(mac, iphone);
  await expect(iphone.main).toHaveAttribute('data-state', 'connecting');
  await carry(iphone, mac);
  await expect(mac.main).toHaveAttribute('data-state', 'connected');
  await expect(iphone.main).toHaveAttribute('data-state', 'connected');
  return { mac, iphone };
}

async function bytesReceived(side) {
  return Number(await side.page.getByTestId('stats').getAttribute('data-bytes-received'));
}

async function expectAudioArriving(side) {
  const before = await bytesReceived(side);
  await expect.poll(() => bytesReceived(side), { timeout: 10_000 }).toBeGreaterThan(before);
}

test('Scenario: an audio call connects by copy-paste', async ({ browser }) => {
  const mac = await test.step('Given two devices with the call page open', () => device(browser, 'Mac'));
  const iphone = await device(browser, 'iPhone');

  await test.step('When the Mac taps Call', async () => {
    await mac.page.getByTestId('call').click();
  });
  await test.step('Then the Mac shows a call text to send', async () => {
    await expect(mac.main).toHaveAttribute('data-state', 'waiting-for-answer');
    await expect(mac.page.getByTestId('outgoing')).not.toHaveValue('');
  });
  await test.step('When the iPhone uses that text', () => carry(mac, iphone));
  await test.step('Then the iPhone shows an answer text to send back', async () => {
    await expect(iphone.main).toHaveAttribute('data-state', 'connecting');
    await expect(iphone.page.getByTestId('outgoing')).not.toHaveValue('');
  });
  await test.step('When the Mac uses the answer', () => carry(iphone, mac));
  await test.step('Then both are connected', async () => {
    await expect(mac.main).toHaveAttribute('data-state', 'connected');
    await expect(iphone.main).toHaveAttribute('data-state', 'connected');
  });
  await test.step('And audio keeps arriving on both sides', async () => {
    await expectAudioArriving(mac);
    await expectAudioArriving(iphone);
  });
});

test('Scenario: hanging up ends the call on both sides', async ({ browser }) => {
  const { mac, iphone } = await test.step('Given a connected call', () => connectedCall(browser));
  await test.step('When the iPhone taps Hang up', async () => {
    await iphone.page.getByTestId('hangup').click();
  });
  await test.step('Then the call has ended on both sides', async () => {
    await expect(iphone.main).toHaveAttribute('data-state', 'ended');
    await expect(mac.main).toHaveAttribute('data-state', 'ended');
  });
});

test('Scenario: a text that is not a call text is refused', async ({ browser }) => {
  const iphone = await test.step('Given the call page open', () => device(browser, 'iPhone'));
  await test.step('When something else is pasted and used', async () => {
    await iphone.page.getByTestId('incoming').fill('hello, not a call');
    await iphone.page.getByTestId('use').click();
  });
  await test.step('Then it says so and nothing starts', async () => {
    await expect(iphone.page.getByTestId('error')).toHaveText("That isn't a call text.");
    await expect(iphone.main).toHaveAttribute('data-state', 'idle');
  });
});

test('Scenario: when both devices tap Call, the one that uses the other\'s text is told what to do', async ({ browser }) => {
  const mac = await test.step('Given two devices that both tapped Call', async () => {
    const side = await device(browser, 'Mac');
    await side.page.getByTestId('call').click();
    await expect(side.main).toHaveAttribute('data-state', 'waiting-for-answer');
    return side;
  });
  const iphone = await device(browser, 'iPhone');
  await iphone.page.getByTestId('call').click();
  await expect(iphone.main).toHaveAttribute('data-state', 'waiting-for-answer');
  await test.step('When the iPhone uses the Mac\'s call text', () => carry(mac, iphone));
  await test.step('Then it explains: Start over on this one, then use the text again', async () => {
    await expect(iphone.page.getByTestId('error')).toHaveText(
      'Both devices tapped Call. On this one, tap Start over, then paste the other device\'s text and tap Use.',
    );
    await expect(iphone.main).toHaveAttribute('data-state', 'waiting-for-answer');
  });
  await test.step('When it starts over and uses the Mac\'s text again', async () => {
    await iphone.page.getByTestId('start-over').click();
    await expect(iphone.main).toHaveAttribute('data-state', 'idle');
    await carry(mac, iphone);
  });
  await test.step('Then the call goes ahead', async () => {
    await expect(iphone.main).toHaveAttribute('data-state', 'connecting');
    await carry(iphone, mac);
    await expect(mac.main).toHaveAttribute('data-state', 'connected');
    await expect(iphone.main).toHaveAttribute('data-state', 'connected');
  });
});

test('Scenario: Start over returns a device to ready', async ({ browser }) => {
  const { mac, iphone } = await test.step('Given a connected call', () => connectedCall(browser));
  await test.step('When the Mac taps Start over', async () => {
    await mac.page.getByTestId('start-over').click();
  });
  await test.step('Then the Mac is ready again, with both text boxes empty', async () => {
    await expect(mac.main).toHaveAttribute('data-state', 'idle');
    await expect(mac.page.getByTestId('incoming')).toHaveValue('');
    await expect(mac.page.getByTestId('outgoing')).toHaveValue('');
    await expect(mac.page.getByTestId('call')).toBeEnabled();
  });
  await test.step('And the call has ended on the iPhone', async () => {
    await expect(iphone.main).toHaveAttribute('data-state', 'ended');
  });
});

test('Scenario: the log records the app going to the background and back', async ({ browser }) => {
  // On a real iPhone, locking the phone or switching apps hides the page;
  // the log is how the manual check sees what the call did meanwhile.
  const { iphone } = await test.step('Given a connected call', () => connectedCall(browser));
  await test.step('When the app is hidden and shown again', async () => {
    await iphone.page.evaluate(() => window.__setVisibility('hidden'));
    await iphone.page.evaluate(() => window.__setVisibility('visible'));
  });
  await test.step('Then the log shows both, with times', async () => {
    const log = iphone.page.getByTestId('log');
    await expect(log).toContainText(/\d\d:\d\d:\d\d app hidden/);
    await expect(log).toContainText(/\d\d:\d\d:\d\d app visible/);
  });
  await test.step('And the call is still connected with audio arriving', async () => {
    await expect(iphone.main).toHaveAttribute('data-state', 'connected');
    await expectAudioArriving(iphone);
  });
});
