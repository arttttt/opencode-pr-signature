/**
 * The signature text, and the one test for whether it is already there.
 */

/**
 * The part of the signature that never varies. Every "is this already signed?"
 * check must use this one string, so changing the signature text can never
 * leave a stale copy behind that silently stops recognizing our own output.
 */
export const SIGNATURE_MARKER = "Generated with [OpenCode]";

const SIGNATURE_URL = "https://opencode.ai";

/**
 * Generate signature
 */
export function generateSignature(modelName: string): string {
  return `🤖 ${SIGNATURE_MARKER}(${SIGNATURE_URL}) (${modelName})`;
}

/**
 * Check if text already contains OpenCode signature
 */
export function hasSignature(text: string): boolean {
  return text.includes(SIGNATURE_MARKER);
}
