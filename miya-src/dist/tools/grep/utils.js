export function formatGrepResult(result) {
    if (result.error) {
        return `Error: ${result.error}`;
    }
    if (result.matches.length === 0) {
        return 'No matches found.';
    }
    const lines = [];
    // Group matches by file
    const byFile = new Map();
    for (const match of result.matches) {
        const existing = byFile.get(match.file) || [];
        existing.push({ line: match.line, text: match.text });
        byFile.set(match.file, existing);
    }
    for (const [file, matches] of byFile) {
        lines.push(`\n${file}:`);
        for (const match of matches) {
            lines.push(`  ${match.line}: ${match.text}`);
        }
    }
    const summary = `Found ${result.totalMatches} matches in ${result.filesSearched} files`;
    if (result.truncated) {
        lines.push(`\n${summary} (output truncated)`);
    }
    else {
        lines.push(`\n${summary}`);
    }
    return lines.join('\n');
}
