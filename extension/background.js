// Click the extension icon to open the side panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
