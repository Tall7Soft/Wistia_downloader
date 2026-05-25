try {
  document
    .querySelectorAll('div[onclick*="__cfRLUnblockHandlers"]')
    .forEach((el) => {
      el.onclick = null;
    });
} catch (e) {}
