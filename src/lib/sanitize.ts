/**
 * Input Sanitization Module
 *
 * SECURITY FIX (AUD-01): Prevents stored XSS by sanitizing user input
 * before storing in the database. Strips HTML tags and dangerous characters
 * from text fields while preserving legitimate content.
 *
 * This is a defense-in-depth measure — the frontend should also escape output,
 * but the backend MUST never store executable content.
 */

/**
 * Characters and patterns that indicate potential XSS
 */
const XSS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<img\b[^>]*>/gi,  // Remove entire img tags (self-closing)
  /<\w+\b[^>]*\bon\w+\s*=[^>]*>/gi, // Remove tags with event handlers completely
  /<\w+\b[^>]*\bjavascript\s*:[^>]*>/gi,
  /<\w+\b[^>]*\bvbscript\s*:[^>]*>/gi,
  /<iframe\b[^>]*>/gi,
  /<object\b[^>]*>/gi,
  /<embed\b[^>]*>/gi,
  /<applet\b[^>]*>/gi,
  /<form\b[^>]*>/gi,
  /<input\b[^>]*>/gi,
  /<svg\b[^>]*>/gi,
];

/**
 * Strip all HTML tags from a string, leaving only text content
 * Uses iterative approach to handle nested and malformed tags correctly
 */
function stripHtmlTags(input: string): string {
  // Remove all HTML tags (including self-closing, malformed, etc.)
  let result = input;
  // Multiple passes to handle nested tags
  for (let i = 0; i < 5; i++) {
    const prev = result;
    result = result.replace(/<[^>]*>/g, '');
    if (result === prev) break; // No more changes
  }
  return result;
}

/**
 * Sanitize a string field to prevent XSS
 * - Strips HTML tags
 * - Removes event handlers (on*)
 * - Removes javascript: URLs
 * - Trims whitespace
 * - Preserves legitimate text content (accents, symbols, etc.)
 */
export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') return input;

  let sanitized = input;

  // First pass: remove known dangerous patterns
  for (const pattern of XSS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Second pass: strip any remaining HTML tags
  sanitized = stripHtmlTags(sanitized);

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Sanitize an object by applying sanitizeString to all string fields
 * Recursively processes nested objects
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T, fieldsToSanitize?: string[]): T {
  const result = { ...obj };

  for (const key of Object.keys(result)) {
    // If fieldsToSanitize is specified, only sanitize those fields
    if (fieldsToSanitize && !fieldsToSanitize.includes(key)) continue;

    const value = result[key];

    if (typeof value === 'string') {
      (result as Record<string, unknown>)[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      (result as Record<string, unknown>)[key] = value.map(item => {
        if (typeof item === 'string') return sanitizeString(item);
        if (item && typeof item === 'object') return sanitizeObject(item as Record<string, unknown>, undefined);
        return item;
      });
    } else if (value && typeof value === 'object') {
      (result as Record<string, unknown>)[key] = sanitizeObject(value as Record<string, unknown>, undefined);
    }
  }

  return result;
}

/**
 * Common text field names that should be sanitized across all entities
 */
export const SANITIZABLE_FIELDS = {
  client: ['name', 'email', 'phone', 'address', 'city', 'state', 'zipCode'],
  vehicle: ['plate', 'brand', 'model', 'color', 'chassi'],
  supplier: ['razaoSocial', 'nomeFantasia', 'email', 'phone', 'address', 'city', 'state', 'zipCode', 'ie'],
  part: ['sku', 'description', 'ncm', 'cfop', 'unit', 'location', 'batch', 'cst', 'csosn'],
  serviceOrder: ['description', 'diagnosis', 'paymentMethod'],
  sale: ['obs', 'paymentMethod'],
  user: ['name', 'email'],
  office: ['name', 'email', 'phone', 'address', 'city', 'state', 'zipCode'],
  mechanic: ['name', 'email', 'phone', 'specialty'],
  financial: ['description', 'category', 'reference', 'paymentMethod'],
};
