# bump-version action

This action will bump versions, create releases and manage tagging.

## If `action` is `prerelease`

The following steps are taken:

- It `prerelease` (`-#`) version (`X.Y.Z-#`) is appended or incremented using `semver`
- The updated version and all modified files are committed (`git add .`)
- A tag is pushed with the same name as the new version
- A draft release is created with the same name with a log of history since the last release

## If `action` is `postrelease`

The following steps are taken:

- The Default Branch is checked out
- The `prerelease` (`-#`) version (`X.Y.Z-#`) is lobbed off using `semver`
- The updated version is committed
- A tag is pushed with the same name as the new version
- The name on the existing published release is updated to the new version

# Inputs

## `action`

**Required** The action to run: 'prerelease' or 'postrelease'

## `repo-token`

**Required** [The GitHub token for this repo](https://docs.github.com/en/actions/reference/authentication-in-a-workflow#example-passing-github_token-as-an-input)

## `major-tag`

_Optional:_ If set, will create/overwrite a tag representing the major release ('v1'). Only applicable during during postrelease

## `commit-message-prefix`

_Optional:_ If set, this prefix will be added to any commit messages

## `release-branch`

_Optional:_ If set, set the branch that version commits will be pushed to

# Outputs

This action has no outputs.

# Example usage

## Run a `prerelease`

```yaml
on:
  push:
    branches: [main]
jobs:
  prerelease:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: scaffoldly/bump-version-action@main
        with:
          action: prerelease
          repo-token: ${{ secrets.GITHUB_TOKEN }}
```

## Run a `postrelease`

```yaml
on:
  release:
    types: [published]
jobs:
  prerelease:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: scaffoldly/bump-version-action@main
        with:
          action: postrelease
          repo-token: ${{ secrets.GITHUB_TOKEN }}
```
