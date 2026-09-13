/**
 * Size a textarea to its content — the box description fields, which edit in
 * place and must read as text rather than as a form.
 *
 * ⚠️ This is what lets those fields drop `resize: vertical`, and dropping it is
 * the point: the browser paints a resize grabber in the corner of any resizable
 * textarea, and over a field that is transparent at rest that diagonal floats in
 * open space attached to nothing — the stray mark to the right of every
 * description on `/boxes`. Growing with the text removes the reason to resize.
 *
 * Usable both as a ref callback (sizes on mount) and from `onInput`.
 */
export function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  // + the border, since `box-sizing: border-box` is global and scrollHeight is
  // the padding box: without it the last line sits under a 2px scrollbar.
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}
