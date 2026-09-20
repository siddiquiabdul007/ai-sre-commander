/**
 * Secret Redactor
 * Automatically sanitizes secrets, bearer tokens, passwords, private keys,
 * and sensitive cloud credentials before model invocation.
 */

const SECRET_PATTERNS = [
  // Bearer tokens and JWTs
  /(bearer\s+)[a-zA-Z0-9_\-\.]{20,}/gi,
  // Generic passwords/secrets in JSON or YAML
  /(["']?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token)["']?\s*[:=]\s*["'])([^"'\r\n]{4,})(["'])/gi,
  // AWS Keys
  /(AKIA[0-9A-Z]{16})/g,
  // Azure connection strings & keys
  /(AccountKey=[a-zA-Z0-9+\/=]{40,})/gi,
  // Private keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[a-zA-Z0-9\/+=\s\r\n]+-----END [A-Z ]*PRIVATE KEY-----/g,
  // GitHub Personal Access Tokens
  /(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})/g
];

export function redactSecrets(input: string): string {
  if (!input) return '';
  let sanitized = input;

  // Mask specific patterns
  sanitized = sanitized.replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{20,}/gi, '$1[REDACTED_BEARER_TOKEN]');
  sanitized = sanitized.replace(/(["']?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token)["']?\s*[:=]\s*["'])([^"'\r\n]{4,})(["'])/gi, '$1[REDACTED_SECRET]$3');
  sanitized = sanitized.replace(/(AKIA[0-9A-Z]{16})/g, '[REDACTED_AWS_KEY]');
  sanitized = sanitized.replace(/(AccountKey=[a-zA-Z0-9+\/=]{40,})/gi, 'AccountKey=[REDACTED_AZURE_KEY]');
  sanitized = sanitized.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[a-zA-Z0-9\/+=\s\r\n]+-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
  sanitized = sanitized.replace(/(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})/g, '[REDACTED_GITHUB_TOKEN]');

  return sanitized;
}

export function redactObject<T>(obj: T): T {
  if (!obj) return obj;
  const jsonStr = JSON.stringify(obj);
  const redactedStr = redactSecrets(jsonStr);
  try {
    return JSON.parse(redactedStr);
  } catch {
    return obj;
  }
}
