import { createHash } from 'node:crypto';
const IRREVERSIBLE_BASH_PATTERNS = [
    /\bgit\s+push\b/i,
    /\bgit\s+remote\s+set-url\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\b[^\n]*\b-f\b/i,
    /\bgit\s+branch\b[^\n]*\b-D\b/i,
    /\brm\s+-[^\n]*\br\b/i,
    /\brm\s+-[^\n]*\bf\b/i,
    /\brm\s+(-rf|-fr)\b/i,
    /\bdel\s+\/[sfpq]/i,
    /\berase\s+\/[sfpq]/i,
    /\bRemove-Item\b[^\n]*\b(-Recurse|-Force)\b/i,
    /\btruncate\b/i,
    /\bcp\b[^\n]*\b-f\b/i,
    />\s*\.env(\.|$)/i,
    /\b(overwrite|truncate)\b/i,
];
const SENSITIVE_PATH_PATTERNS = [
    /\.env(\.|$)/i,
    /\.pem$/i,
    /\.key$/i,
    /cookie/i,
    /credential/i,
    /secret/i,
    /token/i,
];
function normalizePattern(pattern) {
    return pattern.trim().replaceAll('\\', '/');
}
function hasIrreversiblePattern(patterns) {
    return patterns.some((pattern) => IRREVERSIBLE_BASH_PATTERNS.some((rule) => rule.test(pattern)));
}
function hasSensitivePath(patterns) {
    return patterns.some((pattern) => SENSITIVE_PATH_PATTERNS.some((rule) => rule.test(pattern)));
}
function hasIrreversibleEditPattern(patterns) {
    return patterns.some((pattern) => /\b(delete|remove|overwrite|truncate|destroy|wipe)\b/i.test(pattern) ||
        pattern.endsWith('.env') ||
        pattern.includes('/.env'));
}
export function isSideEffectPermission(permission) {
    return (permission === 'edit' ||
        permission === 'bash' ||
        permission === 'external_directory');
}
export function requiredTierForRequest(request) {
    const patterns = request.patterns.map(normalizePattern);
    if (request.permission === 'external_directory')
        return 'THOROUGH';
    if (request.permission === 'bash') {
        return hasIrreversiblePattern(patterns) ? 'THOROUGH' : 'STANDARD';
    }
    if (request.permission === 'edit') {
        if (hasSensitivePath(patterns) || hasIrreversibleEditPattern(patterns)) {
            return 'THOROUGH';
        }
        return 'STANDARD';
    }
    return 'STANDARD';
}
export function buildRequestHash(request, includeMessageContext = true) {
    const payload = {
        permission: request.permission,
        patterns: [...request.patterns].map(normalizePattern).sort(),
        toolCallID: includeMessageContext ? request.toolCallID ?? '' : '',
        messageID: includeMessageContext ? request.messageID ?? '' : '',
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
