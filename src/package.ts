import {dirname, join, normalize, relative, resolve} from 'path'
import {satisfies} from 'semver'
import {parse} from '@iarna/toml'
import {create as glob} from '@actions/glob'

import {GitHubHandle, lastCommitDate} from './github'
import {readFile, stat} from './utils'
import {getCrateVersions} from './crates'

interface RawDependencies {
    [name: string]:
        | string
        | {
              package?: string
              version?: string
              path?: string
          }
}

interface RawManifest {
    workspace?: {
        members?: string[]
    }
    package?: {
        name?: string
        version?: string
        publish?: boolean
    }
    dependencies?: RawDependencies
    'dev-dependencies'?: RawDependencies
    'build-dependencies'?: RawDependencies
}

const manifest_filename = 'Cargo.toml'

async function readManifest(path: string): Promise<RawManifest> {
    try {
        await stat(path)
    } catch (error) {
        throw new Error(`Manifest file '${path}' not found (${error})`)
    }
    let raw
    try {
        raw = await readFile(path, 'utf-8')
    } catch (error) {
        throw new Error(`Error when reading manifest file '${path}' (${error})`)
    }
    try {
        return parse(raw)
    } catch (error) {
        throw new Error(`Error when parsing manifest file '${path}' (${error})`)
    }
}

export interface Package {
    path: string
    version: string
    dependencies: Dependencies
    published?: boolean
}

export interface Dependency {
    version: string
    path?: string
}

export interface Dependencies {
    [name: string]: Dependency
}

export interface Packages {
    [name: string]: Package
}

export async function findPackages(
    base_path: string,
    packages: Packages = {}
): Promise<Packages> {
    const manifest_path = base_path.endsWith(manifest_filename)
        ? base_path
        : join(base_path, manifest_filename)
    const path = dirname(manifest_path)

    const manifest = await readManifest(manifest_path)

    if (typeof manifest.package === 'object') {
        const {package: package_info} = manifest
        if (typeof package_info.name !== 'string') {
            throw new Error(`Missing package name at '${path}'`)
        }
        if (typeof package_info.version !== 'string') {
            throw new Error(`Missing package version at '${path}'`)
        }
        if (package_info.publish !== false) {
            const dependencies: Dependencies = {}

            for (const [dependency_type, manifest_dependencies] of [
                ['normal', manifest.dependencies],
                ['dev', manifest['dev-dependencies']],
                ['build', manifest['build-dependencies']]
            ]) {
                if (typeof manifest_dependencies === 'object') {
                    for (const name in manifest_dependencies) {
                        const dependency = manifest_dependencies[name]
                        if (typeof dependency === 'string') {
                            dependencies[name] = {version: dependency}
                        } else if (typeof dependency == 'object') {
                            if (
                                !dependency.version &&
                                // normal and build deps require a version
                                dependency_type !== 'dev'
                            ) {
                                throw new Error(
                                    `Missing dependency '${name}' version field`
                                )
                            } else if (
                                // throw an error if there is no path or version on dev-dependencies
                                dependency_type === 'dev' &&
                                !dependency.version &&
                                !dependency.path
                            ) {
                                throw new Error(
                                    `Missing dependency '${name}' version field`
                                )
                            } else if (dependency.version) {
                                // only include package in dependency graph if version is specified
                                const package_name =
                                    typeof dependency.package === 'string'
                                        ? dependency.package
                                        : name
                                dependencies[package_name] = {
                                    version: dependency.version,
                                    path: dependency.path
                                }
                            }
                        }
                    }
                }
            }

            packages[package_info.name] = {
                path,
                version: package_info.version,
                dependencies
            }
        }
    }

    if (typeof manifest.workspace == 'object') {
        const tasks: Promise<Packages>[] = []
        const {workspace} = manifest
        if (Array.isArray(workspace.members)) {
            const globber = await glob(
                workspace.members
                    .map(member => join(path, member, manifest_filename))
                    .join('\n')
            )
            const members_paths = await globber.glob()
            const parent_path = resolve(path)
            for (const member_path of members_paths) {
                tasks.push(
                    findPackages(
                        join(path, relative(parent_path, member_path)),
                        packages
                    )
                )
            }
        }
        await Promise.all(tasks)
    }

    return packages
}

export interface CheckPackageError {
    kind:
        | 'unable-to-get-commit-date'
        | 'has-unpublished-changes'
        | 'not-a-workspace-member'
        | 'mismatch-intern-dep-path'
        | 'mismatch-intern-dep-version'
        | 'unable-to-find-extern-dep'
        | 'mismatch-extern-dep-version'
    message: string
}

export async function checkPackages(
    packages: Packages,
    github: GitHubHandle
): Promise<CheckPackageError[]> {
    const tasks: Promise<void>[] = []
    const errors: CheckPackageError[] = []

    for (const package_name in packages) {
        const package_info = packages[package_name]

        tasks.push(
            (async () => {
                const published_versions = await getCrateVersions(package_name)
                if (published_versions) {
                    const version_date = published_versions
                        .filter(({version}) => version === package_info.version)
                        .map(({created}) => created)[0]
                    if (version_date) {
                        let last_changes_date
                        try {
                            // when package with same version already published
                            // we need check package contents modification time
                            last_changes_date = await lastCommitDate(
                                github,
                                package_info.path
                            )
                        } catch (error) {
                            errors.push({
                                kind: 'unable-to-get-commit-date',
                                message: `Unable to determine latest modification time for local package '${package_name}' due to: '${error}'`
                            })
                        }
                        if (
                            last_changes_date &&
                            last_changes_date.getTime() > version_date.getTime()
                        ) {
                            errors.push({
                                kind: 'has-unpublished-changes',
                                message: `It seems package '${package_name}' modified since '${package_info.version}' so new version should be published`
                            })
                        }
                        // mark package as already published
                        package_info.published = true
                    }
                }
            })()
        )

        for (const dependency_name in package_info.dependencies) {
            const dependency = package_info.dependencies[dependency_name]
            if (dependency.path) {
                // internal dependency
                const dependency_package = packages[dependency_name]
                if (!dependency_package) {
                    errors.push({
                        kind: 'not-a-workspace-member',
                        message: `Package '${package_name}' dependes from internal '${dependency_name}' which is not a workspace member. Listed workspace members only will be published`
                    })
                }
                const dependency_path = normalize(
                    join(package_info.path, dependency.path)
                )
                if (dependency_path !== dependency_package.path) {
                    errors.push({
                        kind: 'mismatch-intern-dep-path',
                        message: `Package '${package_name}' depends from internal '${dependency_name}' with path '${dependency_path}' but actual path is '${dependency_package.path}'`
                    })
                }
                if (
                    !satisfies(dependency_package.version, dependency.version)
                ) {
                    errors.push({
                        kind: 'mismatch-intern-dep-version',
                        message: `Package '${package_name}' depends from internal '${dependency_name}' with version '${dependency.version}' but actual version is '${dependency_package.version}'`
                    })
                }
            } else {
                // external dependency
                tasks.push(
                    (async () => {
                        const versions = await getCrateVersions(dependency_name)
                        if (!versions) {
                            errors.push({
                                kind: 'unable-to-find-extern-dep',
                                message: `Package '${package_name}' depends from external '${dependency_name}' which does not published on crates.io`
                            })
                        } else {
                            if (
                                !versions.some(({version}) =>
                                    satisfies(version, dependency.version)
                                )
                            ) {
                                const versions_string = versions
                                    .map(({version}) => version)
                                    .join(', ')
                                errors.push({
                                    kind: 'mismatch-extern-dep-version',
                                    message: `Package '${package_name}' depends from external '${dependency_name}' with version '${dependency.version}' which does not satisfies any of '${versions_string}'`
                                })
                            }
                        }
                    })()
                )
            }
        }
    }
    await Promise.all(tasks)

    return errors
}

export function sortPackages(packages: Packages): string[] {
    let left_names = Object.keys(packages)

    const sorted_names: string[] = []

    for (; left_names.length > 0; ) {
        const new_left_names = left_names.filter(package_name => {
            const {dependencies} = packages[package_name]
            const unresolved_internal_dependencies = Object.entries(
                dependencies
            )
                .filter(
                    ([dependency_name, dependency]) =>
                        !!dependency.path &&
                        !sorted_names.includes(dependency_name)
                )
                .map(([dependency_name]) => dependency_name)
            if (unresolved_internal_dependencies.length === 0) {
                sorted_names.push(package_name)
                return false
            }
            return true
        })
        // This should exclude validation of dev-dependencies once
        // cyclic dev-dependencies are allowed: https://github.com/rust-lang/cargo/issues/4242
        if (new_left_names.length === left_names.length) {
            const left_names_str = left_names.join(', ')
            throw new Error(
                `Cyclic internal dependencies detected in packages: ${left_names_str}`
            )
        }
        left_names = new_left_names
    }

    return sorted_names
}
