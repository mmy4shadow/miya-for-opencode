import type { CliLanguage, SgResult } from './types';
export declare function formatSearchResult(result: SgResult): string;
export declare function formatReplaceResult(result: SgResult, isDryRun: boolean): string;
export declare function getEmptyResultHint(pattern: string, lang: CliLanguage): string | null;
