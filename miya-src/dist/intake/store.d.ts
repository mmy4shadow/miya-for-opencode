import type { IntakeState } from './types';
export declare function createIntakeId(prefix: string): string;
export declare function readIntakeState(projectDir: string): IntakeState;
export declare function writeIntakeState(projectDir: string, state: IntakeState): void;
