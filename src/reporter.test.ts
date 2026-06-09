import * as interfaces from './interfaces';
import { reportCheck, reportIssues } from './reporter';

const mockIssuesCreate = jest.fn();
const mockIssuesAndPullRequests = jest.fn();
const mockFinishCheck = jest.fn();
const mockStartCheck = jest.fn();
const mockCancelCheck = jest.fn();

jest.mock('@actions/core', () => ({
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
}));

jest.mock('@actions/github', () => ({
    context: {
        repo: {
            owner: 'owner',
            repo: 'repo',
        },
    },
    getOctokit: jest.fn(() => ({
        rest: {
            issues: {
                create: mockIssuesCreate,
            },
            search: {
                issuesAndPullRequests: mockIssuesAndPullRequests,
            },
        },
    })),
}));

jest.mock('@clechasseur/rs-actions-core', () => ({
    checks: {
        CheckReporter: jest.fn().mockImplementation(() => ({
            cancelCheck: mockCancelCheck,
            finishCheck: mockFinishCheck,
            startCheck: mockStartCheck,
        })),
    },
}));

const vulnerability = {
    advisory: {
        id: 'RUSTSEC-2024-0001',
        package: 'rustls-webpki',
        title: 'Test advisory',
        description: 'A test advisory description.',
        informational: undefined,
        url: 'https://example.com/advisory',
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
} as interfaces.Vulnerability;

const dependencyTree = {
    command: 'cargo tree -e features -i rustls-webpki',
    output: `rustls-webpki v0.101.7
├── rustls v0.21.12
│   └── example-app v0.1.0
└── rustls feature "webpki"
    └── rustls feature "default"`,
};

describe('reporter', () => {
    beforeEach(() => {
        mockCancelCheck.mockReset();
        mockFinishCheck.mockReset();
        mockIssuesAndPullRequests.mockReset();
        mockIssuesCreate.mockReset();
        mockStartCheck.mockReset();

        mockIssuesAndPullRequests.mockResolvedValue({
            data: {
                total_count: 0,
            },
        });
        mockIssuesCreate.mockResolvedValue({
            data: {
                html_url: 'https://github.com/owner/repo/issues/1',
            },
        });
        mockStartCheck.mockResolvedValue(undefined);
        mockFinishCheck.mockResolvedValue(undefined);
        mockCancelCheck.mockResolvedValue(undefined);
    });

    it('renders Cargo trees in vulnerability issues', async () => {
        await reportIssues('github-token', [vulnerability], [], {
            'rustls-webpki': dependencyTree,
        });

        expect(mockIssuesCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                body: expect.stringContaining('## Cargo tree'),
            }),
        );
        const body = mockIssuesCreate.mock.calls[0][0].body as string;
        expect(body).toContain('rustls feature "webpki"');
        expect(body).toMatchSnapshot();
    });

    it('renders Cargo trees in check reports', async () => {
        await reportCheck('github-token', [vulnerability], [], {
            'rustls-webpki': dependencyTree,
        });

        expect(mockFinishCheck).toHaveBeenCalledWith(
            'success',
            expect.objectContaining({
                text: expect.stringContaining('#### Cargo tree'),
            }),
        );
        const output = mockFinishCheck.mock.calls[0][1];
        expect(output.text).toContain('#### Cargo tree');
        expect(output.text).toMatchSnapshot();
    });

    it('renders Cargo tree failures in vulnerability issues', async () => {
        await reportIssues('github-token', [vulnerability], [], {
            'rustls-webpki': {
                command: 'cargo tree -e features -i rustls-webpki',
                error: 'package ID specification did not match any packages',
            },
        });

        const body = mockIssuesCreate.mock.calls[0][0].body as string;
        expect(body).toContain(
            'Could not generate the Cargo tree with `cargo tree -e features -i rustls-webpki`',
        );
        expect(body).toMatchSnapshot();
    });
});
