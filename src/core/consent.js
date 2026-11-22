// Firefox's built-in data consent for the AI tools. The Firefox build declares
//   data_collection_permissions: { required: ['none'], optional: AI_DATA }
// — injex itself collects nothing; the AI tools send what the person types, and their OpenRouter key, to
// openrouter.ai when they click. Firefox asks once, the first time an AI tool is used; Chrome has no such
// API, so there the click alone is the consent (as before).

/** What the AI tools send to openrouter.ai, in Firefox's data categories. */
export const AI_DATA = ['personalCommunications', 'websiteContent', 'authenticationInfo'];

/** Whether this build declares the AI categories as optional data collection (the Firefox build). */
function declared() {
  try {
    const opt = globalThis.browser?.runtime?.getManifest?.()?.browser_specific_settings?.gecko?.data_collection_permissions?.optional || [];
    return AI_DATA.every((c) => opt.includes(c));
  } catch {
    return false;
  }
}

/**
 * Ask for consent to send AI-tool data. Call it FIRST in a click (or key) handler, before any other await:
 * Firefox only shows the prompt while it is handling the user's action. Resolves true when sending is
 * allowed (always outside Firefox), false when the person declined.
 */
export function aiConsent() {
  const P = globalThis.browser?.permissions;
  if (!P?.request || !declared()) return Promise.resolve(true);
  try {
    return Promise.resolve(P.request({ data_collection: AI_DATA })).then(
      (ok) => !!ok,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** The message to show when consent was declined. */
export const AI_CONSENT_DECLINED = 'Firefox asks before injex sends text to OpenRouter: allow it to use the AI tools (you can change this in about:addons → injex → Permissions)';
