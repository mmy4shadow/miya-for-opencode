import type { ServerLookupResult } from './types';
export declare function findServerForExtension(ext: string): ServerLookupResult;
export declare function getLanguageId(ext: string): string;
export declare function isServerInstalled(command: string[]): boolean;
