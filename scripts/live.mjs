import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {lab} from './studionet.mjs'

const {owner,delegate,read,tx,deploy}=lab('contracts/intake.py')
const fixture=JSON.parse(readFileSync('public/example.json','utf8'))
await deploy()
for(const [slug, files, expected] of [
  ['complete-delivery',fixture.files,'CLEARED'],
  ['incomplete-delivery',fixture.files.filter(file=>file.name!=='README.txt'),'BLOCKED'],
]){
  const key=owner.address+'/'+slug
  async function state(wanted){
    const record=await read('get_case',key)
    assert.equal(record.state,wanted)
    return record
  }
  await tx(slug+'-lodge','lodge',[slug,fixture.id,delegate.address,JSON.stringify(files)],()=>state('LODGED'))
  const checked=await tx(slug+'-reconcile','reconcile',[key],()=>state(expected))
  assert.equal(checked.evidence.doi,fixture.doi)
  assert.deepEqual(checked.differences.missing,expected==='BLOCKED'?['README.txt']:[])
  if(expected==='CLEARED'){
    await tx('wrong-recipient','receive',[key],async()=>{
      const record=await state('CLEARED')
      assert.deepEqual(record,checked)
      return record
    },{expectedError:'RECIPIENT_REQUIRED'})
    await tx('receive','receive',[key],async()=>{
      const record=await state('RECEIVED')
      assert.equal(record.received_by,delegate.address)
      return record
    },{actor:delegate})
  } else {
    await tx('blocked-receipt','receive',[key],async()=>{
      const record=await state('BLOCKED')
      assert.deepEqual(record,checked)
      return record
    },{actor:delegate,expectedError:'NOT_CLEARED'})
  }
}
