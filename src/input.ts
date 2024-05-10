/**
 * Parse action input into a some proper thing.
 */

import { input } from '@clechasseur/rs-actions-core';

// Parsed action input
export interface Input {
    token: string;
    ignore: string[];
    workingDirectory: string;
}

export function get(): Input {
    return {
        token: input.getInput('token', { required: true }),
        ignore: input.getInputList('ignore', { required: false }),
        workingDirectory: input.getInput('working-directory', { required: false }) ?? '.',
    };
}
