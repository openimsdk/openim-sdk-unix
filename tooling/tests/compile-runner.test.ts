import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarmonyOutputFilter, runStreamingCommand } from '../src/compile.js'

test('Harmony live output keeps progress and plugin errors while suppressing warning floods', () => {
  const lines: string[] = []
  const filter = createHarmonyOutputFilter((line) => lines.push(line))
  filter.push('stdout', 'ordinary dependency warning\n项目 demo 开始编译\n开始制作运行包 .hap，请耐心等待 ...\r')
  filter.push('stdout', '开始制作运行包 .hap，请耐心等待 ....\n')
  filter.push('stderr', 'error: typed boundary failed\nat uni_modules/unix-openim-sdk/index.uts:1:1\n')
  filter.flush()
  assert.equal(lines.some((line) => line.includes('ordinary dependency warning')), false)
  assert.equal(lines.filter((line) => line.includes('开始制作运行包')).length, 1)
  assert.equal(lines.some((line) => line.includes('typed boundary failed')), true)
  assert.equal(lines.some((line) => line.includes('uni_modules/unix-openim-sdk')), true)
})

test('streams child output before the command exits', { timeout: 5_000 }, async () => {
  const chunks: string[] = []
  let settled = false
  let markStarted: () => void = () => {}
  const startedOutput = new Promise<void>((resolve) => {
    markStarted = resolve
  })
  const execution = runStreamingCommand(
    process.execPath,
    [
      '-e',
      "setTimeout(() => { process.stdout.write('started\\n'); setTimeout(() => process.stdout.write('finished\\n'), 200) }, 450)",
    ],
    {
      cwd: process.cwd(),
      timeoutMs: 3_000,
      heartbeatMs: 50,
      onOutput: (_stream, chunk) => {
        chunks.push(chunk)
        if (chunks.join('').includes('started')) markStarted()
      },
      onHeartbeat: () => {},
    },
  ).then((result) => {
    settled = true
    return result
  })

  await Promise.race([
    startedOutput,
    execution.then(() => assert.fail('command exited before streaming its started output')),
  ])
  assert.equal(settled, false)
  assert.match(chunks.join(''), /started/)

  const result = await execution
  assert.equal(result.timedOut, false)
  assert.equal(result.status, 0)
  assert.match(result.log, /finished/)
})

test('terminates a child that exceeds the hard timeout', async () => {
  const startedAt = Date.now()
  const result = await runStreamingCommand(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    {
      cwd: process.cwd(),
      timeoutMs: 80,
      heartbeatMs: 20,
      terminateGraceMs: 20,
      onOutput: () => {},
      onHeartbeat: () => {},
    },
  )

  assert.equal(result.timedOut, true)
  assert.ok(Date.now() - startedAt < 2_000)
})
