import {exec} from '@actions/exec'

export async function lastCommitDate(path: string): Promise<Date> {
    let out = ''
    let err = ''

    const ret = await exec(
        'git',
        ['log', '-1', '--no-merges', '--format=%ad', '--', path],
        {
            listeners: {
                stdout(buf: Buffer) {
                    out += buf.toString()
                },
                stderr(buf: Buffer) {
                    err += buf.toString()
                }
            }
        }
    )

    if (0 !== ret) {
        throw new Error(
            `Error when getting last commit date for path '${path}'. (${err})`
        )
    }

    const dates = out
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => new Date(line))

    if (dates.length < 1) {
        throw new Error(
            `Error when getting last commit date for path '${path}'`
        )
    }

    return dates[0]
}
