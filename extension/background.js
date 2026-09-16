// Injects the grabber into whatever tab the user clicked the toolbar
// button on. Uses activeTab rather than host permissions so the
// extension can't touch a page until the user explicitly invokes it —
// that keeps the install prompt free of "read your data on all
// websites", which matters both for user trust and store review.

const api = typeof browser !== 'undefined' ? browser : chrome;

api.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  try {
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['grab.js'],
      // MAIN world, not the isolated content-script world: the grabber
      // relies on fetch(mediaUrl, {credentials:'include'}) being treated
      // as a same-origin request by the platform's CDN, which only holds
      // when it runs in the page's own JS context. This also makes the
      // extension behave identically to the bookmarklet build.
      world: 'MAIN',
    });
  } catch (err) {
    // Most common cause: a page extensions may not script (the browser's
    // own settings pages, the extension gallery, a PDF viewer).
    console.error('OmniSaver: could not inject into this page —', err);
  }
});
