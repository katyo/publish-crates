import {getInput, info, setFailed, warning} from '@actions/core'
import {ExecOptions, exec} from '@actions/exec'

import {checkPackages, findPackages, sortPackages} from './package'
import {awaitCrateVersion} from './crates'
import {githubHandle} from './github'

interface EnvVars {
    [name: string]: string
}

async function run(): Promise<void> {
    const token = getInput('token')
    const path = getInput('path')
    const args = getInput('args')
        .split(/[\n\s]+/)
        .filter(arg => arg.length > 0)
    const registry_token = getInput('registry-token')
    const dry_run = getInput('dry-run') === 'true'
    const ignore_published = getInput('ignore-published')

    const env: EnvVars = {...(process.env as EnvVars)}
    if (registry_token) {
        env.CARGO_REGISTRY_TOKEN = registry_token
    }

    const github = githubHandle(token)

    try {
        info(`Searching cargo packages at '${path}'`)
        const packages = await findPackages(path)
        const package_names = Object.keys(packages).join(', ')
        info(`Found packages: ${package_names}`)

        info(`Checking packages consistency`)
        await checkPackages(packages, github)

        info(`Sorting packages according dependencies`)
        const sorted_packages = sortPackages(packages)

        for (const package_name of sorted_packages) {
            const package_info = packages[package_name]
            if (!package_info.published) {
                const exec_args = ['publish', ...args]
                const exec_opts: ExecOptions = {
                    cwd: package_info.path,
                    env
                }
                if (dry_run) {
                    const args_str = exec_args.join(' ')
                    warning(
                        `Skipping exec 'cargo ${args_str}' in '${package_info.path}' due to 'dry-run: true'`
                    )
                    warning(
                        `Skipping awaiting when '${package_name} ${package_info.version}' will be available due to 'dry-run: true'`
                    )
                } else {
                    try {
                        info(`Publishing package '${package_name}'`)
                        await exec('cargo', exec_args, exec_opts)
                        await awaitCrateVersion(package_name, package_info.version)
                        await exec('cargo', ['update'], exec_opts)
                        // wait for the new version again
                        // to make sure that the new version is published
                        await awaitCrateVersion(package_name, package_info.version)
                        info(`Package '${package_name}' published successfully`)
                    } catch (error) {
                        if (ignore_published && error.message.includes(`crate version \`${package_info.path}\` is already uploaded`)) {
                            warning(
                                `Ignore error when '${package_name} ${package_info.version}' is already uploaded due to 'ignore-published: true'`
                            )
                        } else {
                            setFailed(error.message)
                        }
                    }
                }
            }
        }
    } catch (error) {
        setFailed(error.message)
    }
}

run()
