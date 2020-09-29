import {getInput, setFailed, info, warning} from '@actions/core'
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
    const dry_run = getInput('dry-run') === 'true'

    try {
        info(`Searching cargo packages at '${path}'`)
        const packages = await findPackages(path)
        await checkPackages(packages)
        const package_names = Object.keys(packages).join(', ')
        info(`Found packages: ${package_names}`)

        info(`Checking packages consistency`)

        info(`Sorting packages according dependencies`)
        const sorted_packages = sortPackages(packages)

        for (const package_name of sorted_packages) {
            const package_info = packages[package_name]
            if (!package_info.published) {
                const manifest_path = manifestPath(package_info.path)
                const exec_args = [
                    'publish',
                    '--manifest-path',
                    manifest_path,
                    ...args
                ]
                if (dry_run) {
                    warning(
                        `Skipping exec 'cargo ${exec_args.join(
                            ' '
                        )}' due to 'dry-run: true'`
                    )
                    warning(
                        `Skipping awaiting when '${package_name} ${package_info.version}' will be available due to 'dry-run: true'`
                    )
                } else {
                    info(`Publishing package '${package_name}'`)
                    await exec('cargo', exec_args)
                    await awaitCrateVersion(package_name, package_info.version)
                    info(`Package '${package_name}' published successfully`)
                }
            }
        }
    } catch (error) {
        setFailed(error.message)
    }
}

run()
