// Toolbar badge: the number of critical / high hidden-text findings the scanner saw on a tab.

/** { n, critical } for a list of scanner findings. */
export function badgeCount(findings = []) {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const high = findings.filter((f) => f.severity === 'high').length;
  return { n: critical + high, critical };
}

export async function setScanBadge(tabId, findings) {
  if (typeof chrome === 'undefined' || !chrome.action || tabId == null) return;
  const { n, critical } = badgeCount(findings);
  try {
    await chrome.action.setBadgeText({ tabId, text: n ? (n > 99 ? '99+' : String(n)) : '' });
    if (n) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: critical ? '#ff5c5c' : '#ff9b42' });
      await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
    }
    await chrome.action.setTitle({ tabId, title: n ? `injex — ${n} hidden-text finding${n === 1 ? '' : 's'} on this page` : 'injex' });
  } catch {
    /* the tab is gone */
  }
}
