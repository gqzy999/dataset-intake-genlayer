import './style.css'
import {createAccount,createClient,generatePrivateKey} from 'genlayer-js'
import {getAddress} from 'viem'
import {chain,rpc,explorer,reader,checkNetwork,waitFinalized,readWindow} from './chain.js'

const $ = id => document.getElementById(id)
const deployment = await fetch('./deployment.json').then(response=>response.json())
const wallets = []
let actor, provider, current, address, balance, busy = false
const temporary = []
const status = message => { $('status').textContent=message }
const validAddress = /^0x[0-9a-f]{40}$/i
const ref = /^0x[a-f0-9]{40}\/[a-z0-9-]{3,36}$/
const link = (label,path)=>{
  const anchor=document.createElement('a')
  anchor.textContent=label
  anchor.href=explorer+path
  anchor.target='_blank'
  anchor.rel='noopener'
  return anchor
}
function offer(p) {
  if(p?.request && !wallets.includes(p)) wallets.push(p)
}
window.addEventListener('eip6963:announceProvider',event=>offer(event.detail.provider))
window.dispatchEvent(new Event('eip6963:requestProvider'))
offer(window.ethereum)

function update(){
  $('reconcile').hidden=!(actor && current?.state==='LODGED')
  $('receive').hidden=!(current?.state==='CLEARED' && actor===current.recipient)
  $('export').hidden=current?.state!=='RECEIVED'
  $('account').textContent=actor ? actor+' · Stable Studionet (61999)'+(provider?'':' · Temporary signer'+(balance===undefined?'':' · '+balance+' wei')) : 'Public reads are available without a wallet.'
}
function action(id, handler){
  const node=$(id)
  node.addEventListener(node.tagName==='FORM'?'submit':'click',async event=>{
    event.preventDefault()
    if(busy) return
    busy=true
    const controls=[...document.querySelectorAll('button,input,select,textarea')]
    controls.forEach(control=>control.disabled=true)
    try {await handler()}
    catch(error){status(error.shortMessage??error.message??String(error))}
    finally {busy=false;controls.forEach(control=>control.disabled=false);update()}
  })
}

async function selectActor(account){
  actor=account?.address.toLowerCase()
  if(!actor){update();return}
  balance=undefined
  const amount=await reader.request({method:'eth_getBalance',params:[account.address,'latest']})
  update()
  balance=BigInt(amount)
  update()
}

async function network(wallet){
  if(Number(await wallet.request({method:'eth_chainId'}))===61999) return
  try {await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xf22f'}]})}
  catch(error){
    if(Number(error.code)!==4902) throw error
    await wallet.request({method:'wallet_addEthereumChain',params:[{
      chainId:'0xf22f',chainName:'Stable Studionet',rpcUrls:[rpc],
      blockExplorerUrls:[explorer],nativeCurrency:{name:'GEN',symbol:'GEN',decimals:18},
    }]})
    if(Number(await wallet.request({method:'eth_chainId'}))!==61999){
      await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xf22f'}]})
    }
  }
  if(Number(await wallet.request({method:'eth_chainId'}))!==61999) throw Error('Switch to Stable Studionet.')
}
action('wallet',async()=>{
  const selected=wallets[0]
  if(!selected) throw Error('No injected wallet found. A temporary test wallet is available.')
  await network(selected)
  const [account]=await selected.request({method:'eth_requestAccounts'})
  actor=account?.toLowerCase()
  provider=selected
  $('actors').selectedIndex=-1
  update()
})
action('temporary',async()=>{
  if(temporary.length===3) throw Error('Reset the test wallets before creating another.')
  const account=createAccount(generatePrivateKey())
  const option=new Option('Test wallet '+(temporary.length+1)+' · '+account.address.slice(0,10),temporary.length)
  temporary.push(account)
  $('actors').add(option)
  $('actors').value=option.value
  provider=null
  await selectActor(account)
})
$('actors').onchange=()=>{provider=null;selectActor(temporary[Number($('actors').value)]).catch(error=>status(error.message))}
action('disconnect',async()=>{
  provider=null
  actor=null
  balance=undefined
  temporary.length=0
  $('actors').replaceChildren()
})
function target(){
  if(!validAddress.test($('contract').value.trim())) throw Error('Enter a valid contract address.')
  return getAddress($('contract').value.trim().toLowerCase())
}
function key(){
  const value=$('key').value.trim().toLowerCase()
  if(!ref.test(value)) throw Error('Enter a wallet/slug delivery reference.')
  return value
}
function show(record) {
  current=record
  $('state').textContent=record?.state ?? 'No delivery open'
  $('decision').textContent={
    LODGED:'Any wallet can request consensus on the fixed version manifest.',
    CLEARED:'Every submitted file matches the official name, size and checksum. The named recipient can acknowledge.',
    BLOCKED:'The manifests differ. Acknowledgement is disabled. Lodge a new delivery to correct the differences.',
    RECEIVED:'The designated recipient has acknowledged the verified manifest. Download the handoff record.',
  }[record?.state] ?? 'Open a delivery to read its finalized chain state.'
  const roles=$('roles')
  roles.replaceChildren()
  $('trail').replaceChildren()
  $('source').hidden=!record
  $('files').hidden=!record
  if(record){
    $('source').href='https://zenodo.org/api/records/'+record.record_id
    for(const [label,value] of Object.entries({Lodged:record.owner,Recipient:record.recipient,Reconciled:record.verifier,Received:record.received_by,DOI:record.evidence?.doi,Contract:address})){
      const row=document.createElement('div')
      const term=document.createElement('dt')
      const detail=document.createElement('dd')
      term.textContent=label
      if(label==='Contract') detail.append(link(address,'/address/'+address))
      else detail.textContent=value??'—'
      row.append(term,detail);roles.append(row)
    }
    const official=record.evidence?.files??{}
    const submitted=record.expected
    $('files').querySelector('tbody').replaceChildren(...[...new Set([...Object.keys(submitted),...Object.keys(official)])].sort().map(name=>{
      const a=Object.hasOwn(submitted,name)?submitted[name]:null
      const b=Object.hasOwn(official,name)?official[name]:null
      const result=!record.evidence?'Awaiting':!a?'Missing':!b?'Extra':a.size===b.size&&a.checksum===b.checksum?'Matched':'Changed'
      const row=document.createElement('tr')
      row.dataset.result=result
      for(const value of [name,a,b,result]){
        const cell=document.createElement('td')
        if(value && typeof value==='object'){
          cell.textContent=value.size.toLocaleString()+' bytes'
          const digest=document.createElement('small')
          digest.textContent=value.checksum
          cell.append(digest)
        }else cell.textContent=value??'—'
        row.append(cell)
      }
      return row
    }))
    const steps=deployment.cases?.find(item=>item.key===key()&&address.toLowerCase()===deployment.address.toLowerCase())?.steps??[]
    for(const step of steps){
      const item=document.createElement('li')
      item.append(link(step.label+' · '+step.execution,'/transactions/'+step.hash))
      $('trail').append(item)
    }
  }
  update()
}
async function load(){
  address=target()
  const record=await readWindow(address,key())
  show(record)
  status(record?'Finalized delivery loaded':'No finalized delivery for this reference')
  return record
}
action('lookup',load)
for(const id of ['contract','key']) $(id).oninput=()=>show(null)
async function send(method,args,reference,expected){
  if(!actor) throw Error('Connect a wallet.')
  const contract=target()
  if(!deployment.address || contract.toLowerCase()!==deployment.address.toLowerCase()) throw Error('Writes require the published, verified Dataset Intake contract.')
  await checkNetwork()
  const from=actor
  let signer
  if(provider){
    const wallet=provider
    await network(wallet)
    const [active]=await wallet.request({method:'eth_accounts'})
    if(active?.toLowerCase()!==from) throw Error('Reconnect after switching wallet accounts.')
    signer=createClient({chain,account:active,provider:{async request(request){
      if(request.method==='eth_sendTransaction'){
        const [tx]=request.params
        if(Number(await wallet.request({method:'eth_chainId'}))!==61999 || BigInt(tx.value??0)!==0n || BigInt(tx.gasPrice??1)!==0n) throw Error('Expected zero value and zero gas price on Stable Studionet.')
      }
      return wallet.request(request)
    }}})
  }else signer=createClient({chain,account:temporary.find(account=>account.address.toLowerCase()===from)})
  const purpose=method+' · '+from+' · Stable Studionet 61999'
  status(purpose+' · Awaiting signature')
  if(!provider && !window.confirm('Send '+purpose+'?')) {status('Signature cancelled');return}
  const hash=await signer.writeContract({address:contract,functionName:method,args,value:0n,leaderOnly:false})
  $('tx').href=explorer+'/transactions/'+hash
  $('tx').hidden=false
  status('Submitted '+hash)
  await waitFinalized(hash,stage=>status('Consensus · '+stage))
  $('key').value=reference
  const record=await load()
  if(!expected.includes(record?.state)) throw Error('Transaction finalized but the expected state could not be read.')
  status('FINALIZED / SUCCESS · '+record.state)
}
action('lodge',()=>{
  const slug=$('slug').value
  return send('lodge',[slug,Number($('id').value),getAddress($('recipient').value),JSON.stringify(JSON.parse($('manifest').value))],actor+'/'+slug,['LODGED'])
})
action('reconcile',()=>send('reconcile',[key()],key(),['CLEARED','BLOCKED']))
action('receive',()=>send('receive',[key()],key(),['RECEIVED']))
action('export',async()=>{
  const blob=new Blob([JSON.stringify({chainId:61999,address,key:key(),record:current},null,2)],{type:'application/json'})
  const url=URL.createObjectURL(blob)
  const anchor=document.createElement('a')
  anchor.href=url
  anchor.download='dataset-handoff.json'
  anchor.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
})
$('contract').value=deployment.address??''
for(const [index,item] of (deployment.cases??[]).entries()){
  const button=document.createElement('button')
  button.id='example-'+index
  button.textContent=item.label
  $('examples').append(button)
  action(button.id,async()=>{$('contract').value=deployment.address;$('key').value=item.key;await load()})
}
update()

if(!deployment.address) status('No verified contract deployment is configured. This site is a preview and cannot submit transactions.')
