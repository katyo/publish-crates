import {getCrateVersions, awaitCrateVersion} from '../src/crates'
import {findPackages, checkPackages, sortPackages} from '../src/package'
import {githubHandle, lastCommitDate} from '../src/github'
import {join} from 'path'
import {exec} from '@actions/exec'
const pkg_dir = __dirname

test('find packages', async () => {
    const packages = await findPackages(pkg_dir)

    expect(Object.keys(packages).length).toBe(4)

    const pkg_all = packages['pkg-all']
    const pkg_sys = packages['pkg-sys']
    const pkg_lib = packages['pkg-lib']
    const pkg_bin = packages['pkg-bin']

    expect(pkg_all.path).toBe(pkg_dir)
    expect(pkg_all.version).toBe('0.1.0')
    expect(Object.keys(pkg_all.dependencies).length).toBe(2)

    expect(pkg_sys.path).toBe(join(pkg_dir, 'pkg-sys'))
    expect(pkg_sys.version).toBe('0.1.0')
    expect(Object.keys(pkg_sys.dependencies).length).toBe(0)

    expect(pkg_lib.path).toBe(join(pkg_dir, 'pkg-lib'))
    expect(pkg_lib.version).toBe('0.1.0')
    expect(Object.keys(pkg_lib.dependencies).length).toBe(2)

    expect(pkg_bin.path).toBe(join(pkg_dir, 'pkg-bin'))
    expect(pkg_bin.version).toBe('0.1.0')
    expect(Object.keys(pkg_bin.dependencies).length).toBe(2)
})

test('check packages', async () => {
    const packages = await findPackages(pkg_dir)
    await checkPackages(packages, githubHandle())
}, 10000)

test('sort packages', async () => {
    const packages = await findPackages(pkg_dir)
    const sorted = sortPackages(packages)

    expect(sorted).toEqual(['pkg-sys', 'pkg-lib', 'pkg-bin', 'pkg-all'])
})

test('get crate versions', async () => {
    const versions = await getCrateVersions('serde')

    expect(versions).toBeDefined()

    if (versions) {
        expect(versions.length).toBeGreaterThanOrEqual(200)

        const version1 = versions.filter(
            version_info => version_info.version == '1.0.0'
        )[0]
        expect(version1).toBeDefined()
        expect(version1.version).toBe('1.0.0')
        expect(version1.created).toEqual(
            new Date('2017-04-20T15:26:44.055136+00:00')
        )
    }
})

test('await crate version', async () => {
    await awaitCrateVersion('serde', '1.0.0', 10000)
}, 15000)

test('await crate version timeout', async () => {
    try {
        await awaitCrateVersion(
            'undefined-unexpected-unknown-abcxyz',
            '1.0.0',
            10000
        )
    } catch (e) {
        expect((e as Error).message).toBe(
            "Timeout '10000ms' reached when awaiting crate 'undefined-unexpected-unknown-abcxyz' version '1.0.0'"
        )
    }
}, 15000)

test('last commit date', async () => {
    const github = githubHandle()
    let date
    try {
        date = await lastCommitDate(github, '__tests__/pkg-sys')
    } catch (err) {}
    if (date) {
        expect(date).toEqual(new Date('2020-09-27T20:43:58Z'))
    }
})

/*
test('test run', async () => {
  const main = join(__dirname, '..', 'lib', 'main.js')
  const res = await exec('node', [main], { env: {
    'INPUT_PATH': pkg_dir,
    'INPUT_DRY-RUN': 'true',
    'INPUT_ARGS': '--allow-dirty',
    ...process.env
  } });
  expect(res).toBe(0)
})
*/
