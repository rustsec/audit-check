const mockCargoCall = jest.fn();
const mockFindOrInstall = jest.fn();
const mockReportIssues = jest.fn();
const mockReportCheck = jest.fn();
const mockSetFailed = jest.fn();

jest.mock('@actions/core', () => ({
    debug: jest.fn(),
    endGroup: jest.fn(),
    info: jest.fn(),
    setFailed: mockSetFailed,
    startGroup: jest.fn(),
    warning: jest.fn(),
}));

jest.mock('@actions/github', () => ({
    context: {
        eventName: 'schedule',
        repo: {
            owner: 'owner',
            repo: 'repo',
        },
    },
}));

jest.mock('@clechasseur/rs-actions-core', () => ({
    Cargo: {
        get: jest.fn(async () => ({
            call: mockCargoCall,
            findOrInstall: mockFindOrInstall,
        })),
    },
}));

jest.mock('./input', () => ({
    get: jest.fn(() => ({
        ignore: undefined,
        token: 'github-token',
        workingDirectory: 'crate',
    })),
}));

jest.mock('./reporter', () => ({
    reportCheck: mockReportCheck,
    reportIssues: mockReportIssues,
}));

const vulnerableAuditReport = {
    database: {
        'advisory-count': 2,
        'last-commit': 'abc123',
        'last-updated': '2024-01-01',
    },
    lockfile: {
        'dependency-count': 3,
    },
    vulnerabilities: {
        found: true,
        count: 2,
        list: [
            {
                advisory: {
                    id: 'RUSTSEC-2024-0001',
                    package: 'rustls-webpki',
                    title: 'First advisory',
                    description: 'first',
                    informational: undefined,
                    url: 'https://example.com/first',
                    date: '2024-01-01',
                },
                package: {
                    name: 'rustls-webpki',
                    version: '0.101.7',
                },
                versions: {
                    patched: [],
                    unaffected: [],
                },
            },
            {
                advisory: {
                    id: 'RUSTSEC-2024-0002',
                    package: 'rustls-webpki',
                    title: 'Second advisory',
                    description: 'second',
                    informational: undefined,
                    url: 'https://example.com/second',
                    date: '2024-01-02',
                },
                package: {
                    name: 'rustls-webpki',
                    version: '0.101.7',
                },
                versions: {
                    patched: [],
                    unaffected: [],
                },
            },
        ],
    },
    warnings: [],
};

const cleanAuditReport = {
    database: {
        'advisory-count': 0,
        'last-commit': 'abc123',
        'last-updated': '2024-01-01',
    },
    lockfile: {
        'dependency-count': 3,
    },
    vulnerabilities: {
        found: false,
        count: 0,
        list: [],
    },
    warnings: [],
};

let auditReport = vulnerableAuditReport;
let cargoTreeExitCode = 0;

async function importMain(): Promise<void> {
    await jest.isolateModulesAsync(async () => {
        await import('./main');
    });
}

async function waitForExpect(assertion: () => void): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    throw lastError;
}

describe('main reporting flow', () => {
    beforeEach(() => {
        mockCargoCall.mockReset();
        mockFindOrInstall.mockReset();
        mockReportIssues.mockReset();
        mockReportCheck.mockReset();
        mockSetFailed.mockReset();
        auditReport = vulnerableAuditReport;
        cargoTreeExitCode = 0;

        mockCargoCall.mockImplementation(async (args, options) => {
            if (args[0] === 'audit') {
                options.listeners.stdout(Buffer.from(JSON.stringify(auditReport)));
                return 1;
            }

            if (args[0] === 'tree') {
                if (cargoTreeExitCode !== 0) {
                    options.listeners.stderr(
                        Buffer.from(
                            'package ID specification did not match any packages',
                        ),
                    );
                    return cargoTreeExitCode;
                }

                options.listeners.stdout(
                    Buffer.from(
                        `rustls-webpki v0.101.7
├── rustls v0.21.12
└── rustls feature "webpki"
    └── rustls feature "default"`,
                    ),
                );
                return 0;
            }

            throw new Error(`Unexpected cargo command: ${args.join(' ')}`);
        });
    });

    it('passes one feature-aware Cargo tree per vulnerable package to scheduled issues', async () => {
        await importMain();

        await waitForExpect(() => {
            expect(mockReportIssues).toHaveBeenCalled();
        });

        const treeCalls = mockCargoCall.mock.calls.filter(
            ([args]) => args[0] === 'tree',
        );
        expect(treeCalls).toHaveLength(1);
        expect(treeCalls[0][0]).toEqual([
            'tree',
            '-e',
            'features',
            '-i',
            'rustls-webpki',
        ]);
        expect(treeCalls[0][1]).toEqual(
            expect.objectContaining({
                cwd: 'crate',
                ignoreReturnCode: true,
            }),
        );

        expect(mockReportIssues).toHaveBeenCalledWith(
            'github-token',
            vulnerableAuditReport.vulnerabilities.list,
            [],
            {
                'rustls-webpki': {
                    command: 'cargo tree -e features -i rustls-webpki',
                    output: expect.stringContaining('rustls feature "webpki"'),
                },
            },
        );
        expect(mockReportCheck).not.toHaveBeenCalled();
        expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('passes Cargo tree errors to scheduled issues without failing the action', async () => {
        cargoTreeExitCode = 101;

        await importMain();

        await waitForExpect(() => {
            expect(mockReportIssues).toHaveBeenCalled();
        });

        expect(mockReportIssues).toHaveBeenCalledWith(
            'github-token',
            vulnerableAuditReport.vulnerabilities.list,
            [],
            {
                'rustls-webpki': {
                    command: 'cargo tree -e features -i rustls-webpki',
                    error: 'package ID specification did not match any packages',
                },
            },
        );
        expect(mockSetFailed).not.toHaveBeenCalled();
    });

    it('does not collect Cargo trees when there is nothing to report', async () => {
        auditReport = cleanAuditReport;

        await importMain();

        await waitForExpect(() => {
            expect(mockCargoCall).toHaveBeenCalled();
        });

        const treeCalls = mockCargoCall.mock.calls.filter(
            ([args]) => args[0] === 'tree',
        );
        expect(treeCalls).toHaveLength(0);
        expect(mockReportIssues).not.toHaveBeenCalled();
        expect(mockReportCheck).not.toHaveBeenCalled();
        expect(mockSetFailed).not.toHaveBeenCalled();
    });
});
