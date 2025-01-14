[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](https://opensource.org/licenses/MIT)
[![CI Status](https://github.com/katyo/publish-crates/workflows/build-test/badge.svg)](https://github.com/katyo/publish-crates/actions)

# Publish Rust crates using GitHub Actions

The action is using [`cargo metadata`](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html) with format version
`1` to collect the information about crates and workspace.

## Features

- Reads manifests to get info about crates and dependencies
- Checks versions of external dependencies to be exists in registry
- Checks matching paths and versions of internal dependencies
- Checks that no changes happened since published release when version of internal dependency is not changed
- Skips publishing of internal dependencies which does not updated
- Publishes updated crates in right order according to dependencies
- Awaits when published crate will be available in registry before publishing crates which depends from it
- Works fine in workspaces without cyclic dependencies
- Support `{ workspace = true }` syntax in the `Cargo.toml`. [This](https://rust-lang.github.io/rfcs/2906-cargo-workspace-deduplicate.html)
  feature was stabilized in Rust 1.64.

## Unimplemented features

- Support different registries than [crates.io](https://crates.io/)

## Inputs

- `token` GitHub API token (`github.token` by default)
- `path` Sets path to crate or workspace ('.' by default)
- `args` Extra arguments for `cargo publish` command
- `registry-token` Cargo registry token (not used when `dry-run: true`)
- `dry-run` Set to `true` to bypass exec `cargo publish`
- `check-repo` Set to `false` to bypass check local packages for modifications since last published version
- `publish-delay` Optional delay in milliseconds applied after publishing each package before publishing others
- `no-verify` Set to `true` to bypass cyclic dependency detection and cargo packaging verification (uses `--no-verify`)
- `ignore-unpublished-changes` Set to `true` to exit the workflow gracefully if package does not have a new version to publish

Each local package (workspace member) potentially may be modified since last published version without
corresponding version bump. This situation is dangerous and should be prevented. In order to do it this
action uses GitHub API to get date of latest commit which modified contents by path of corresponding package.
This date compares with date of last published version of that package. When option `check-repo` set to `true`
(which is by default) this action will throw error in case when last commit date cannot be determined.
This happenned in case of detached refs (like pull requests). Usually you should never publish packages via
pull-requests so you may simply disable this action for run in such cases (via `if` expression as example).
When you want to run action (say with `dry-run` set to `true`) prevent failing you may simply set `check-repo`
to `false` too.

**NOTE**: You should avoid setting both `check-repo` and `dry-run` to `false`.

Usually you don't need to set `publish-delay` because this action check availability of previously published
packages before publishing other but in some cases it may help work around __crates.io__ inconsistency
problems.

## Outputs

- `published` JSON formatted string with published crates as array of objects with `name` and `version` fields.

You may want to use it with [`fromJSON`][fromJSON] function and object filters syntax
[1][object filters-join], [2][object filters-contains].

__This works whether "dry-run" is enabled or not.__
That means that when `dry-run: true` you will get packages that could have been published.

[fromJSON]: https://docs.github.com/en/actions/learn-github-actions/expressions#fromjson
[object filters-join]: https://docs.github.com/en/actions/learn-github-actions/expressions#example-of-join
[object filters-contains]: https://docs.github.com/en/actions/learn-github-actions/expressions#example-using-an-object-filter

## Usage examples

Basic usage (`Cargo.toml` sits in repository root):

```yaml
steps:
    - uses: actions/checkout@v3
    - uses: actions-rs/toolchain@v1
      with:
          toolchain: stable
          override: true
    - uses: katyo/publish-crates@v2
      with:
          registry-token: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

Advanced usage (`Cargo.toml` sits in 'packages' subdir, and you would like to skip verification and bypass real publishing):

```yaml
steps:
    - uses: actions/checkout@v3
    - uses: actions-rs/toolchain@v1
      with:
          toolchain: stable
          override: true
    - uses: katyo/publish-crates@v2
      with:
          path: './packages'
          args: --no-verify
          dry-run: true
```

Do all checks in both push and pull requests, but only publish on push:

```yaml
steps:
    - uses: actions/checkout@v3
    - uses: actions-rs/toolchain@v1
      with:
          toolchain: stable
          override: true
    - uses: katyo/publish-crates@v2
      with:
          dry-run: ${{ github.event_name != 'push' }}
```

Prevent failing when there is no new version to publish:

```yaml
steps:
    - uses: actions/checkout@v3
    - uses: actions-rs/toolchain@v1
      with:
          toolchain: stable
          override: true
    - uses: katyo/publish-crates@v2
      with:
          registry-token: ${{ secrets.CARGO_REGISTRY_TOKEN }}
          ignore-unpublished-changes: true
```

Output usage:

```yaml
    - uses: katyo/publish-crates@v2
      id: publish-crates
      with:
          registry-token: ${{ secrets.CARGO_REGISTRY_TOKEN }}

    - name: if my-crate published
          if: fromJSON(steps.publish-crates.outputs.published).*
          run: |
            LIST="${{ join(fromJSON(steps.publish-crates.outputs.published).*.name, ', ') }}"
            echo "Published crates: $LIST"
```
**NOTE**: This is also works if `dry-run` is enabled. It explained in [Outputs](#outputs).
