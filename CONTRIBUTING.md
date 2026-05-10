# Contributing

Thanks for contributing to Mi Casa Su Casa.

## Workflow

### Features

For non-trivial work, **start with an issue first**.

1. Open or reference a feature issue
2. Align on scope and acceptance criteria
3. Implement in a pull request linked to that issue
4. Include tests

### Bugs

Bug fixes should generally reference an issue, unless the change is a tiny obvious correction.

### Documentation

Small documentation improvements can go straight to a PR, but larger documentation changes should still reference an issue if they change project expectations.

## Definition of done

A feature is only done when all of the following are true:

- implementation is complete
- tests are added or updated
- CI is green
- docs are updated if behavior or setup changed

## Main branch policy

- PRs only to `main`
- no direct pushes
- required CI checks before merge

Repository settings should enforce this with branch protection on `main`.

Recommended protection rules:

- require a pull request before merging
- require the CI workflow to pass before merging
- dismiss or re-run checks when the PR head changes
- prevent direct pushes to `main`

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:apply:local
npm run dev
```

## Commands

```bash
npm run format
npm run check
npm run typecheck
npm run test
npm run build
```

## Testing expectations

Every feature should improve or preserve confidence in deployability.

That means:

- unit tests for isolated logic
- integration tests for API + DB + auth boundaries
- end-to-end coverage for critical flows when relevant

At minimum, every PR is expected to keep the following commands green:

```bash
npm run check
npm run typecheck
npm run test
npm run build
```

## Pull requests

Each PR should:

- link a GitHub issue
- explain what changed and why
- include test evidence
- stay focused in scope

## Code of conduct

By participating in this project, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
