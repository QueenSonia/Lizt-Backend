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
        'font-weight': [/^(bold|normal|[1-9]00)$/],
        'text-decoration': [/^(underline|none|line-through)$/],
        'font-style': [/^(italic|normal)$/],
        'text-align': [/^(left|right|center|justify)$/],
        color: [/^#(?:[0-9a-f]{3}){1,2}$/i, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/i],
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
