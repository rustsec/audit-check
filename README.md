# Audit Check

![MIT licensed](https://img.shields.io/badge/license-MIT-blue.svg)

This action audits your Rust dependencies for security vulnerabilities using [cargo-audit](https://github.com/RustSec/cargo-audit). It reports vulnerabilities as status checks and can automatically create issues for scheduled runs.

## Usage

<!-- start usage -->
```yaml
- uses: rustsec/audit-check@v2
  with:
    # Personal access token (PAT) used to create checks and issues.
    # [Learn more about creating and using encrypted secrets](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets)
    # Default: ${{ github.token }}
    token: ''

    # Comma-separated list of advisory IDs to ignore
    ignore: ''

    # The directory containing Cargo.toml and Cargo.lock files
    # Default: .
    working-directory: ''
```
<!-- end usage -->

## Scenarios

- [Audit on pull request](#audit-on-pull-request)
- [Audit when dependencies change](#audit-when-dependencies-change)
- [Scheduled daily audit](#scheduled-daily-audit)
- [Ignore specific advisories](#ignore-specific-advisories)
- [Audit a workspace subdirectory](#audit-a-workspace-subdirectory)

### Audit on pull request

The simplest configuration runs on every pull request and push:

```yaml
name: Security audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: rustsec/audit-check@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

When vulnerabilities are found, the action creates a failed status check with details:

![Check screenshot](.github/check_screenshot.png)

> [!NOTE]
> Informational advisories do not cause the check to fail.

### Audit when dependencies change

Optimize your CI by only running audits when `Cargo.toml` or `Cargo.lock` files change:

```yaml
name: Security audit
on:
  push:
    paths:
      - '**/Cargo.toml'
      - '**/Cargo.lock'
  pull_request:
    paths:
      - '**/Cargo.toml'
      - '**/Cargo.lock'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: rustsec/audit-check@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

### Scheduled daily audit

Run audits on a schedule to catch newly published advisories:

```yaml
name: Security audit
on:
  schedule:
    # Run daily at midnight UTC
    - cron: '0 0 * * *'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: rustsec/audit-check@v2
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
```

For scheduled runs, the action creates GitHub issues for each new advisory:

![Issue screenshot](.github/issue_screenshot.png)

> [!NOTE]
> Issues are only created for scheduled workflows. For push and pull request events, the action fails the check instead.

### Ignore specific advisories

Some advisories may not apply to your use case:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: dtolnay/rust-toolchain@stable
  - uses: rustsec/audit-check@v2
    with:
      token: ${{ secrets.GITHUB_TOKEN }}
      ignore: RUSTSEC-2020-0001,RUSTSEC-2020-0002
```

### Audit a workspace subdirectory

For monorepos or projects with Cargo files in subdirectories:

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: dtolnay/rust-toolchain@stable
  - uses: rustsec/audit-check@v2
    with:
      token: ${{ secrets.GITHUB_TOKEN }}
      working-directory: backend/
```

## Inputs

<!-- start inputs -->
| Name | Description | Default |
| --- | --- | --- |
| **`token`** | **Required.** GitHub token for creating checks and issues. Use `${{ secrets.GITHUB_TOKEN }}` or a personal access token. | |
| `ignore` | Comma-separated list of advisory IDs to ignore (e.g., `RUSTSEC-2020-0001,RUSTSEC-2020-0002`) | |
| `working-directory` | Directory containing `Cargo.toml` and `Cargo.lock` files to audit | `.` |
<!-- end inputs -->

## Permissions

The action requires the following permissions:

```yaml
permissions:
  contents: read   # Required to see the contents of the repository
  checks: write    # Create status checks for PR runs
  issues: write    # Create issues for scheduled runs
```


## License

The scripts and documentation in this project are released under the [MIT License](LICENSE).
