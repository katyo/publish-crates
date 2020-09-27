import {getInput, setFailed, info} from '@actions/core'
import {exec} from '@actions/exec'
import {
    manifestPath,
    findPackages,
    checkPackages,
    sortPackages
} from './package'
import {awaitCrateVersion} from './crates'

async function run(): Promise<void> {
    const path = getInput('path')
    const args = getInput('args')
        .split(/[\n\s]+/)
        .filter(arg => arg.length > 0)

    const verify = getInput('verify') !== 'false'
    const dry_run = getInput('dry-run') === 'true'

    if (!verify) {
        args.unshift('--no-verify')
    }
    if (dry_run) {
        args.unshift('--dry-run')
    }

    try {
        info(`Find cargo packages at '${path}'`)
        const packages = await findPackages(path)
        await checkPackages(packages)
        const sorted_packages = sortPackages(packages)
        for (const package_name of sorted_packages) {
            const package_info = packages[package_name]
            if (!package_info.published) {
                const manifest_path = manifestPath(package_info.path)
                await exec('cargo', [
                    'publish',
                    '--manifest-path',
                    manifest_path,
                    ...args
                ])
                await awaitCrateVersion(package_name, package_info.version)
            }
        }
    } catch (error) {
        setFailed(error.message)
    }
}

run()
