/**
 * Advottic browser extension - service worker.
 *
 * Handles the context-menu entry "Save to Advottic case" and the
 * messaging from the popup. The actual save POSTs to the Advottic
 * public API at /api/v1/exhibits with the user's API token, which
 * is stored in chrome.storage.local after they paste it once in
 * the popup. We never inline a token in the extension package.
 */

const ENDPOINT = 'https://advottic.com/api/v1/exhibits';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'advottic-save-selection',
    title: 'Save to Advottic case',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'advottic-save-selection') return;
  const text = info.selectionText;
  if (!text) return;
  await saveExcerpt({
    text,
    sourceUrl: tab && tab.url,
    sourceTitle: tab && tab.title,
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'save-excerpt') {
    saveExcerpt(msg.payload).then(sendResponse).catch((err) =>
      sendResponse({ ok: false, error: String(err && err.message) }),
    );
    return true;
  }
  return false;
});

async function saveExcerpt(payload) {
  const { token, defaultCaseId } = await chrome.storage.local.get([
    'token',
    'defaultCaseId',
  ]);
  if (!token) {
    return { ok: false, error: 'No API token configured. Open the extension popup to paste one.' };
  }
  const body = {
    case_id: payload.caseId || defaultCaseId || null,
    label: payload.sourceTitle ? `Saved from ${payload.sourceTitle}` : 'Saved excerpt',
    source_url: payload.sourceUrl || null,
    text: payload.text,
  };
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, error: t.slice(0, 200) };
  }
  return { ok: true };
}
