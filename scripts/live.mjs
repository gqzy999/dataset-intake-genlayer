import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lab } from './studionet.mjs'

const { owner, delegate, read, tx, deploy } = lab('contracts/intake.py')
const fixture = JSON.parse(readFileSync('public/dryad-example.json', 'utf8'))
const missing = fixture.files[0].name
const official = Object.fromEntries(fixture.files.map(file => [file.name, file]))

async function exercise(slug, sender, recipient, files, omissions, extra=[]) {
  const key = sender.address + '/' + slug
  const expected = omissions.length ? 'BLOCKED' : 'CLEARED'
  async function state(wanted) {
    const record = await read('get_case', key)
    assert.equal(record.state, wanted)
    assert.equal(record.archive, 'dryad')
    return record
  }
  await tx(slug+'-lodge', 'lodge_dryad', [
    slug, fixture.id, recipient.address, JSON.stringify(files),
  ], () => state('LODGED'), {actor:sender})
  const checked = await tx(slug+'-reconcile', 'reconcile', [key], () => state(expected), {actor:sender})
  assert.equal(checked.evidence.doi, fixture.doi)
  assert.deepEqual(checked.evidence.files, official)
  assert.deepEqual(checked.differences, {missing:omissions, extra, changed:[]})
  return {key, state, checked}
}

await deploy()
const [complete, incomplete] = await Promise.all([
  exercise('complete-delivery', owner, delegate, fixture.files, []),
  exercise('incomplete-delivery', delegate, owner, fixture.files.slice(1), [missing]),
])
await tx('wrong-recipient', 'receive', [complete.key], async()=> {
  const record=await complete.state('CLEARED')
  assert.deepEqual(record,complete.checked)
  return record
}, {actor:owner, expectedError:'RECIPIENT_REQUIRED'})
await tx('receive', 'receive', [complete.key], async()=> {
  const record=await complete.state('RECEIVED')
  assert.equal(record.received_by,delegate.address)
  return record
}, {actor:delegate})
await tx('blocked-receipt', 'receive', [incomplete.key], async()=> {
  const record=await incomplete.state('BLOCKED')
  assert.deepEqual(record,incomplete.checked)
  return record
}, {actor:owner, expectedError:'NOT_CLEARED'})
