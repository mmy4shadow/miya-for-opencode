/**
 * Post-Read nudge - appends a delegation reminder after file reads.
 * Catches the "read files → implement myself" anti-pattern.
 */
const NUDGE = '\n\n---\nReminder to follow the workflow instructions, consider delegation to specialist(s)';
export function createPostReadNudgeHook() {
    return {
        'tool.execute.after': async (input, output) => {
            // Only nudge for Read tool
            if (input.tool !== 'Read' && input.tool !== 'read') {
                return;
            }
            // Append the nudge
            output.output = output.output + NUDGE;
        },
    };
}
