import sanitizeHtml from 'sanitize-html';

/**
 * Sanitize renewal-letter / tenant-facing HTML bodies.
 *
 * Allows the set of tags the landlord can produce via the contentEditable
 * letter preview (basic typography + inline style for font-weight /
 * text-decoration / font-style / color only). Strips scripts, iframes,
 * images, inline event handlers, and javascript: URLs.
 *
 * Applied server-side on write. Clients also re-sanitize on render
 * (defense-in-depth — see isomorphic-dompurify on the tenant page).
 */
export function sanitizeLetterHtml(dirty: string | null | undefined): string | null {
  if (dirty == null) return null;
  const trimmed = String(dirty).trim();
  if (!trimmed) return null;

  return sanitizeHtml(trimmed, {
    allowedTags: [
      'p',
      'br',
      'div',
      'span',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'u',
      'sub',
      'sup',
      'h1',
      'h2',
      'h3',
      'h4',
      'b',
      'i',
      'hr',
    ],
    allowedAttributes: {
      '*': ['style'],
      span: ['style', 'data-field', 'class'],
      div: ['style', 'data-field', 'class'],
      p: ['style', 'class'],
      li: ['style'],
      ul: ['style'],
      ol: ['style'],
    },
    allowedStyles: {
      '*': {
        // Typography
        'font-weight': [/^(bold|normal|[1-9]00)$/],
        'font-style': [/^(italic|normal)$/],
        'font-size': [/^\d+(\.\d+)?(px|em|rem|%)$/],
        'font-family': [/^[\w\s,'"-]+$/],
        'line-height': [/^\d+(\.\d+)?(px|em|rem|%)?$/],
        'text-decoration': [/^(underline|none|line-through)$/],
        'text-align': [/^(left|right|center|justify)$/],
        'text-transform': [/^(uppercase|lowercase|capitalize|none)$/],
        color: [/^#(?:[0-9a-f]{3}){1,2}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i],

        // Spacing — 1 to 4 length values, optionally negative or auto.
        // The contentEditable letter emits per-side margins/paddings via
        // React inline-style camelCase, but the captured HTML serializes
        // them as separate longhand properties as well as occasional
        // shorthands (e.g. page-break divider uses `60px -40px 40px`).
        margin: [/^(-?\d+(\.\d+)?(px|em|rem|%)|auto|0)(\s+(-?\d+(\.\d+)?(px|em|rem|%)|auto|0)){0,3}$/],
        'margin-top': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
        'margin-right': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
        'margin-bottom': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
        'margin-left': [/^-?\d+(\.\d+)?(px|em|rem|%)$/],
        padding: [/^(\d+(\.\d+)?(px|em|rem|%)|0)(\s+(\d+(\.\d+)?(px|em|rem|%)|0)){0,3}$/],
        'padding-top': [/^\d+(\.\d+)?(px|em|rem|%)$/],
        'padding-right': [/^\d+(\.\d+)?(px|em|rem|%)$/],
        'padding-bottom': [/^\d+(\.\d+)?(px|em|rem|%)$/],
        'padding-left': [/^\d+(\.\d+)?(px|em|rem|%)$/],

        // Sizing — letterhead logo footprint and prose container.
        width: [/^(\d+(\.\d+)?(px|em|rem|%)|auto)$/],
        height: [/^(\d+(\.\d+)?(px|em|rem|%)|auto)$/],
        'min-width': [/^(\d+(\.\d+)?(px|em|rem|%)|0|auto)$/],
        'max-height': [/^\d+(\.\d+)?(px|em|rem|%)$/],

        // Layout — flex row used for the date/recipient/logo header.
        display: [/^(block|inline|inline-block|flex|inline-flex|grid|none)$/],
        'justify-content': [/^(flex-start|flex-end|center|space-between|space-around|space-evenly)$/],
        'align-items': [/^(flex-start|flex-end|center|baseline|stretch)$/],
        gap: [/^\d+(\.\d+)?(px|em|rem)$/],
        'flex-wrap': [/^(nowrap|wrap|wrap-reverse)$/],
        flex: [/^[\d.\s]+(auto)?$/],

        // Lists — bullets in the offer terms.
        'list-style': [/^(disc|circle|square|decimal|none)$/],

        // Borders — service-charge footnote rule and page-break divider.
        border: [/^\d+(\.\d+)?px\s+(solid|dashed|dotted)\s+(#[0-9a-f]{3,8}|rgba?\([\d\s.,]+\))$/i],
        'border-top': [/^\d+(\.\d+)?px\s+(solid|dashed|dotted)\s+(#[0-9a-f]{3,8}|rgba?\([\d\s.,]+\))$/i],

        // Object fit — already-saved letters with embedded signature/logo
        // imgs may carry this; harmless to allow.
        'object-fit': [/^(contain|cover|fill|none|scale-down)$/],
      },
    },
    allowedSchemes: [],
    disallowedTagsMode: 'discard',
    // Strip anything that could introduce script execution.
    exclusiveFilter: (frame) => {
      if (frame.tag === 'script' || frame.tag === 'iframe' || frame.tag === 'style') {
        return true;
      }
      return false;
    },
  });
}
