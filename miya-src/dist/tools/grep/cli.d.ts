import type { CountResult, GrepOptions, GrepResult } from './types';
export declare function runRg(options: GrepOptions): Promise<GrepResult>;
export declare function runRgCount(options: Omit<GrepOptions, 'context'>): Promise<CountResult[]>;
