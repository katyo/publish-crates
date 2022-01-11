import {
    error,
    getBooleanInput,
    getInput,
    info,
    setFailed,
    warning
} from '@actions/core'
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
    const dry_run = getBooleanInput('dry-run')
    const check_repo = getBooleanInput('check-repo')

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
        let package_errors = await checkPackages(packages, github)

        for (const {message} of package_errors) {
            error(message)
        }

        if (!check_repo) {
            package_errors = package_errors.filter(
                ({kind}) => kind !== 'unable-to-get-commit-date'
            )
        }

        if (package_errors.length > 0) {
            throw new Error(
                `${package_errors.length} packages consistency error(s) found`
            )
        }

        info(`Sorting packages according to dependencies`)
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
                    info(`Publishing package '${package_name}'`)
                    await exec('cargo', exec_args, exec_opts)
                    await awaitCrateVersion(package_name, package_info.version)
                    await exec('cargo', ['update'], exec_opts)
                    info(`Package '${package_name}' published successfully`)
                }
            }
        }
    } catch (err) {
        setFailed(`${err}`)
    }
}

run()
