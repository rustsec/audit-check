/**
 * Parse action input into a some proper thing.
 */

import { input } from '@rinse-repeat/actions-rs-core';
import { getInputList } from '@rinse-repeat/actions-rs-core/dist/input';

// Parsed action input
export interface Input {
    token: string;
    ignore: string[];
}

export function get(): Input {
    return {
        token: input.getInput('token', { required: true }),
        ignore: getInputList('ignore', { required: false }),
    };
}
