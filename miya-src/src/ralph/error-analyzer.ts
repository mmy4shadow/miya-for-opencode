import type { RalphFailureAnalysis } from './types';

export function analyzeFailure(output: string): RalphFailureAnalysis {
  const text = output.toLowerCase();

  if (
    text.includes('cannot find module') ||
    text.includes('module not found') ||
    text.includes('command not found') ||
    text.includes('is not recognized as an internal or external command')
  ) {
    return {
      kind: 'dependency_missing',
      summary: 'Dependencies or required binaries are missing.',
      suggestedFixes: [
        'bun install',
        'npm install',
        'check PATH and tool installation',
      ],
    };
  }

  if (
    text.includes('ts2339') ||
    text.includes('type error') ||
    text.includes('typescript')
  ) {
    return {
      kind: 'type_error',
      summary: 'Type checking failed.',
      suggestedFixes: [
        'fix reported TypeScript diagnostics',
        'run bun run typecheck',
      ],
    };
  }

  if (
    text.includes('eslint') ||
    text.includes('biome') ||
    text.includes('lint')
  ) {
    return {
      kind: 'lint_error',
      summary: 'Lint checks failed.',
      suggestedFixes: ['run bun run lint', 'apply formatter and lint fixes'],
    };
  }

  if (
    text.includes('test failed') ||
    text.includes('failing') ||
    text.includes('assert') ||
    text.includes('expect(')
  ) {
    return {
      kind: 'test_failure',
      summary: 'Verification tests failed.',
      suggestedFixes: [
        'inspect failing test output',
        'fix logic and rerun tests',
      ],
    };
  }

  if (text.includes('permission denied') || text.includes('eacces')) {
    return {
      kind: 'permission_denied',
      summary: 'Execution failed due to permission restrictions.',
      suggestedFixes: [
        'adjust permissions',
        'run in allowed directory/context',
      ],
    };
  }

  if (text.includes('timed out') || text.includes('timeout')) {
    return {
      kind: 'timeout',
      summary: 'Command hit timeout before completion.',
      suggestedFixes: ['increase timeout', 'split the task into smaller steps'],
    };
  }

  return {
    kind: 'unknown',
    summary: 'Verification failed with an unclassified error.',
    suggestedFixes: ['inspect stdout/stderr and add a targeted fix command'],
  };
}
