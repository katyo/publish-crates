import {join, normalize} from 'path'
import {parse} from '@iarna/toml'
import {satisfies} from 'semver'
import {getCrateVersions} from './crates'
import {GitHubHandle, lastCommitDate} from './github'
import {stat, readFile} from './utils'

interface RawManifest {
    workspace?: {
        members?: string[]
    }
    package?: {
        name?: string
        version?: string
        publish?: boolean
    }
    dependencies?: {
        [name: string]:
            | string
            | {
                  package?: string
                  version?: string
                  path?: string
              }
    }
}

export function manifestPath(path: string): string {
    return join(path, 'Cargo.toml')
}

async function readManifest(path: string): Promise<RawManifest> {
    const manifest_path = manifestPath(path)
    try {
        await stat(manifest_path)
    } catch (error) {
        throw new Error(
            `Manifest file '${manifest_path}' not found (${error.message})`
        )
    }
    let raw
    try {
        raw = await readFile(manifest_path, 'utf-8')
    } catch (error) {
        throw new Error(
            `Error when reading manifest file '${manifest_path}' (${error.message})`
        )
    }
    try {
        return parse(raw) as RawManifest
    } catch (error) {
        throw new Error(
            `Error when parsing manifest file '${manifest_path}' (${error.message})`
        )
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
    path: string,
    packages: Packages = {}
): Promise<Packages> {
    const manifest = await readManifest(path)

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

            if (typeof manifest.dependencies === 'object') {
                for (const name in manifest.dependencies) {
                    const dependency = manifest.dependencies[name]
                    if (typeof dependency === 'string') {
                        dependencies[name] = {version: dependency}
                    } else if (typeof dependency == 'object') {
                        if (!dependency.version) {
                            throw new Error(
                                `Missing dependency '${name}' version field`
                            )
                        }
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
            const {members} = workspace
            for (const member of members) {
                tasks.push(findPackages(join(path, member), packages))
            }
        }
        await Promise.all(tasks)
    }

    return packages
}

export async function checkPackages(
    packages: Packages,
    github: GitHubHandle
): Promise<void> {
    const tasks: Promise<void>[] = []
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
                        // when package with same version already published
                        // we need check package contents modification time
                        const last_changes_date = await lastCommitDate(
                            github,
                            package_info.path
                        )
                        if (
                            last_changes_date.getTime() > version_date.getTime()
                        ) {
                            throw new Error(
                                `It seems package '${package_name}' modified since '${package_info.version}' so new version should be published`
                            )
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
                const dependency_path = normalize(
                    join(package_info.path, dependency.path)
                )
                if (dependency_path !== dependency_package.path) {
                    throw new Error(
                        `Package '${package_name}' depends from internal '${dependency_name}' with path '${dependency_path}' but actual path is '${dependency_package.path}'`
                    )
                }
                if (dependency.version !== dependency_package.version) {
                    throw new Error(
                        `Package '${package_name}' depends from internal '${dependency_name}' with version '${dependency.version}' but actual version is '${dependency_package.version}'`
                    )
                }
            } else {
                // external dependency
                tasks.push(
                    (async () => {
                        const versions = await getCrateVersions(dependency_name)
                        if (!versions) {
                            throw new Error(
                                `Package '${package_name}' depends from external '${dependency_name}' which does not published on crates.io`
                            )
                        }
                        if (
                            !versions.some(({version}) =>
                                satisfies(version, dependency.version)
                            )
                        ) {
                            const versions_string = versions
                                .map(({version}) => version)
                                .join(', ')
                            throw new Error(
                                `Package '${package_name}' depends from external '${dependency_name}' with version '${dependency.version}' which does not satisfies any of '${versions_string}'`
                            )
                        }
                    })()
                )
            }
        }
    }
    await Promise.all(tasks)
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
