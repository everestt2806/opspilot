import {
  parseMemoryPressure,
  parseOomKillCount,
  parseTopProcesses
} from '../src/main/vps/operationalDiagnostics'

if (process.argv[2] !== '--fixture') {
  console.error('Cách dùng: pnpm try:vps-diagnostics --fixture')
  process.exitCode = 2
} else {
  const pressure = parseMemoryPressure(
    'some avg10=0.2 avg60=0.1 avg300=0.1 total=10\nfull avg10=0.0 avg60=0.0 avg300=0.0 total=0'
  )
  const oom = parseOomKillCount('oom_kill 0\n')
  const processes = parseTopProcesses('PID RSS COMMAND\n101 2048 node\n202 512 postgres\n')
  const unavailable = {
    pressure: parseMemoryPressure('unsupported'),
    oom: parseOomKillCount('missing counter'),
    processes: parseTopProcesses('command failed')
  }
  if (!pressure || oom !== 0 || !processes || processes.length !== 2) {
    throw new Error('Fixture diagnostics parser check failed.')
  }
  if (unavailable.pressure !== null || unavailable.oom !== null || unavailable.processes !== null) {
    throw new Error('Fixture unsupported-source check failed.')
  }
  console.log(
    JSON.stringify(
      {
        fixture_mode: true,
        pressure,
        oom_kill_count: oom,
        top_processes_available: true,
        top_processes: processes,
        unsupported_sources: 'represented as null/unavailable'
      },
      null,
      2
    )
  )
}
