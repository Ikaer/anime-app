// Copy text to the clipboard, resolving to whether it actually landed.
//
// The NAS serves over plain HTTP, where `navigator.clipboard` is normally
// absent — but a browser can still expose it there (e.g. Chrome's "insecure
// origins treated as secure" flag) and then REJECT the write. So the async API
// is tried only as a first attempt, and any rejection falls through to the
// `execCommand` path instead of failing silently. The fallback's own return
// value is honoured too: the caller shows a ✓ only on a real copy.
export async function copyText(text: string): Promise<boolean> {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // fall through to the legacy path
        }
    }
    return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
    const previous = document.activeElement as HTMLElement | null;
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    // Off-screen rather than opacity 0 alone, so it can never be hit-tested
    // or scroll the page when focused.
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '-9999px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    el.setSelectionRange(0, text.length);
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } catch {
        ok = false;
    }
    document.body.removeChild(el);
    previous?.focus?.();
    return ok;
}
