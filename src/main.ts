import * as process from 'process';
import * as os from 'os';

import * as core from '@actions/core';
import * as github from '@actions/github';

import { Cargo } from '@clechasseur/rs-actions-core';

import * as input from './input';
import * as interfaces from './interfaces';
import * as reporter from './reporter';

async function getData(
    ignore: string[] | undefined,
    workingDirectory: string,
): Promise<interfaces.Report> {
    const cargo = await Cargo.get();
    await cargo.findOrInstall('cargo-audit');

    let stdout = '';
    try {
        core.startGroup('Calling cargo-audit (JSON output)');
        const commandArray = ['audit'];
        for (const item of ignore ?? []) {
            commandArray.push('--ignore', item);
        }
        commandArray.push('--json');
        commandArray.push('--file', `${workingDirectory}/Cargo.lock`);
        await cargo.call(commandArray, {
            ignoreReturnCode: true,
            listeners: {
                stdout: (buffer) => {
                    stdout += buffer.toString();
                },
            },
        });
    } finally {
        // Cool story: `cargo-audit` JSON output is missing the trailing `\n`,
        // so the `::endgroup::` annotation from the line below is being
        // eaten by it.
        // Manually writing the `\n` to denote the `cargo-audit` end
        process.stdout.write(os.EOL);
        core.endGroup();
    }

    return JSON.parse(stdout);
}

function summarizeTreeError(error: string): string {
    const summary = error.trim().split(/\r?\n/)[0];
    return summary || 'cargo tree exited without an error message';
}

export async function collectDependencyTrees(
    vulnerabilities: Array<interfaces.Vulnerability>,
    workingDirectory: string,
): Promise<interfaces.DependencyTrees> {
    const packageNames = [
        ...new Set(vulnerabilities.map((item) => item.package.name)),
    ];
    const dependencyTrees: interfaces.DependencyTrees = {};

    if (packageNames.length === 0) {
        return dependencyTrees;
    }

    const cargo = await Cargo.get();

    for (const packageName of packageNames) {
        const command = `cargo tree -e features -i ${packageName}`;
        let stdout = '';
        let stderr = '';

        try {
            core.startGroup(`Calling ${command}`);
            const exitCode = await cargo.call(
                ['tree', '-e', 'features', '-i', packageName],
                {
                    cwd: workingDirectory,
                    ignoreReturnCode: true,
                    listeners: {
                        stdout: (buffer) => {
                            stdout += buffer.toString();
                        },
                        stderr: (buffer) => {
                            stderr += buffer.toString();
                        },
                    },
                },
            );

            if (exitCode === 0) {
                dependencyTrees[packageName] = {
                    command: command,
                    output: stdout.trim(),
                };
            } else {
                const error = summarizeTreeError(stderr || stdout);
                core.warning(
                    `Unable to generate reverse dependency tree for ${packageName}: ${error}`,
                );
                dependencyTrees[packageName] = {
                    command: command,
                    error: error,
                };
            }
        } catch (error) {
            const summary = summarizeTreeError((error as Error).message);
            core.warning(
                `Unable to generate reverse dependency tree for ${packageName}: ${summary}`,
            );
            dependencyTrees[packageName] = {
                command: command,
                error: summary,
            };
        } finally {
            core.endGroup();
        }
    }

    return dependencyTrees;
}

function removeTrailingSlash(str: string): string {
    if (str[str.length - 1] === '/') {
        return str.substr(0, str.length - 1);
    }
    return str;
}

export async function run(actionInput: input.Input): Promise<void> {
    const ignore = actionInput.ignore;
    const workingDirectory = removeTrailingSlash(actionInput.workingDirectory);
    const report = await getData(ignore, workingDirectory);
    let shouldReport = false;
    if (!report.vulnerabilities.found) {
        core.info('No vulnerabilities were found');
    } else {
        core.warning(`${report.vulnerabilities.count} vulnerabilities found!`);
        shouldReport = true;
    }

    // In `cargo-audit < 0.12` report contained an array of `Warning`.
    // In `cargo-audit >= 0.12` it is a JSON object,
    // where key is a warning type, and value is an array of `Warning` of that type.
    let warnings: Array<interfaces.Warning> = [];
    if (Array.isArray(report.warnings)) {
        warnings = report.warnings;
    } else {
        for (const items of Object.values(report.warnings)) {
            warnings = warnings.concat(items);
        }
    }

    if (warnings.length === 0) {
        core.info('No warnings were found');
    } else {
        core.warning(`${warnings.length} warnings found!`);
        shouldReport = true;
    }

    if (!shouldReport) {
        return;
    }

    // const octokit = github.getOctokit(actionInput.token, {userAgent: USER_AGENT});
    const advisories = report.vulnerabilities.list;
    const dependencyTrees = await collectDependencyTrees(
        advisories,
        workingDirectory,
    );
    if (github.context.eventName == 'schedule') {
        core.debug(
            'Action was triggered on a schedule event, creating an Issues report',
        );
        await reporter.reportIssues(
            actionInput.token,
            advisories,
            warnings,
            dependencyTrees,
        );
    } else {
        core.debug(
            `Action was triggered on a ${github.context.eventName} event, creating a Check report`,
        );
        await reporter.reportCheck(
            actionInput.token,
            advisories,
            warnings,
            dependencyTrees,
        );
    }
}

async function main(): Promise<void> {
    try {
        const actionInput = input.get();
        await run(actionInput);
    } catch (error) {
        core.setFailed((error as Error).message);
    }

    return;
}

main();
