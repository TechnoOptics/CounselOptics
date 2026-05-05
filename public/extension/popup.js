const tokenEl = document.getElementById('token');
const caseEl = document.getElementById('case');
const saveEl = document.getElementById('save');
const msgEl = document.getElementById('msg');

(async function init() {
  const stored = await chrome.storage.local.get(['token', 'defaultCaseId']);
  if (stored.token) tokenEl.value = stored.token;
  if (stored.defaultCaseId) caseEl.value = stored.defaultCaseId;
})();

saveEl.addEventListener('click', async () => {
  const token = tokenEl.value.trim();
  const defaultCaseId = caseEl.value.trim();
  if (!token.startsWith('adv_')) {
    msgEl.className = 'err';
    msgEl.textContent = 'Token should start with adv_';
    return;
  }
  await chrome.storage.local.set({ token, defaultCaseId });
  msgEl.className = 'ok';
  msgEl.textContent = 'Saved. Highlight text on any page, right-click, then Save to Advottic case.';
});
