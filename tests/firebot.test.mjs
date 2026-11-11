import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFirebotPayments, validatePixAmount } from '../lib/firebot.js';
import { digest } from '../lib/payments.js';
import { validInput, memoryStore } from './fixtures.mjs';
import { firebotEnv, firebotGateway, firebotEvent } from './firebot-fixtures.mjs';
function setup({ env = firebotEnv, fetcher } = {}) {
  let time = Date.now();
  const store = memoryStore(), gateway = firebotGateway(), logs = [];
  const api = makeFirebotPayments({ store, env, fetcher: fetcher || gateway.fetcher, now: () => time,
    logger: { info: (...v) => logs.push(v), warn: (...v) => logs.push(v) } });
  return { store, gateway, api, logs, advance: ms => { time += ms; }, transaction: () => [...gateway.transactions.values()][0] };
}

test('FireBot enforces the acquirer minimum and maximum before creating a charge', () => {
  for (const amount of [3, 4, 5.99]) assert.throws(() => validatePixAmount(amount), /valor mínimo/);
  assert.doesNotThrow(() => validatePixAmount(6));
  assert.doesNotThrow(() => validatePixAmount(1000));
  assert.throws(() => validatePixAmount(1000.01), /um ingresso/);
});

test('an explicit minimum-amount rejection is retryable without repeating the original submission', async () => {
  let calls = 0;
  const ctx = setup({fetcher:async()=>{calls++;return Response.json({success:false,message:'Axxon Pay: amount: Number must be greater than or equal to 10'},{status:400});}});
  const input=validInput(), order=await ctx.api.create(input,'test');
  assert.equal(order.status,'FAILED'); assert.equal(order.retryable,true); assert.equal(order.pix,null);
  assert.equal(order.failure.minimum,10); assert.match(order.failure.message,/R\$\s*10,00/);
  await ctx.api.create(input,'test'); assert.equal(calls,1);
  assert.equal((await ctx.api.status(order.token)).retryable,true);
});

test('a generic rejection or uncertain response never permits another automatic charge', async () => {
  for(const [status,result] of [[400,{message:'Axxon Pay: Erro Sicredi: Request failed with status code 403'}],
    [500,{message:'Axxon Pay: amount: Number must be greater than or equal to 10'}],
    [400,{transactionId:'fire_tx_existing12345',message:'Axxon Pay: amount: Number must be greater than or equal to 10'}]]) {
    const ctx=setup({fetcher:async()=>Response.json(result,{status})}),order=await ctx.api.create(validInput(),'test');
    assert.equal(order.status,'REVIEW'); assert.equal(order.retryable,false);
  }
});
test('FireBot creates all three server-priced products with unbranded local QR and minimal buyer data', async () => {
  for (const [product, amount] of [['mba',6],['pos',6],['imersao',6]]) {
    const ctx = setup(), result = await ctx.api.create({ ...validInput(product), amount: 5 }, 'test');
    const call = ctx.gateway.calls[0];
    assert.equal(call.url, 'https://firebotbr.com/api/v1/pix/create');
    assert.equal(call.options.headers['x-api-key'], firebotEnv.FIREBOT_API_KEY);
    assert.deepEqual(call.input, { amount, productType:'DIGITAL', description: ctx.store.data.get(`orders/${result.orderId}`).product.name,
      storeUrl:`https://black-netfiscal.vercel.app/checkout/${product}`, qrStyle:'plain',
      customer:{name:'Aluno de Teste',email:'aluno@example.com',cpf:'11144477735',phone:'11999998888'} });
    assert.equal(result.status,'PENDING'); assert.equal(result.amount,amount); assert.equal(result.redirect,null);
    assert.match(result.pix.image,/^data:image\/png;base64,/); assert.equal(result.pix.code,'LOCAL_TEST_ONLY_NOT_A_PAYMENT');
    assert.match(result.orderId,/^nf-fb-/);
    for(const privateValue of ['aluno@example.com','11144477735',firebotEnv.FIREBOT_API_KEY,'untrusted-image']) assert.ok(!JSON.stringify(result).includes(privateValue));
  }
});
test('FireBot rejects invalid ticket quantities and buyers before a gateway request', async () => {
  const ctx=setup(), input=validInput('imersao'); input.quantity=6;
  await assert.rejects(()=>ctx.api.create(input,'test'),/Quantidade/);
  await assert.rejects(()=>ctx.api.create({...validInput(),buyer:{name:'A',email:'x',phone:'0',document:'0'}},'test'),/Confira/);
  assert.equal(ctx.gateway.calls.length,0);
});
test('FireBot submits only once across retries and concurrent calls', async () => {
  const ctx=setup(), input=validInput();
  const [a,b]=await Promise.all([ctx.api.create(input,'test'),ctx.api.create(input,'test')]);
  assert.equal(a.orderId,b.orderId);assert.equal(ctx.gateway.calls.length,1);
  assert.equal((await ctx.api.create(input,'test')).token,a.token);
  await assert.rejects(()=>ctx.api.create({...input,buyer:{...input.buyer,email:'different@example.com'}},'test'),/já foram enviados/);
});
test('FireBot confirms by authenticated API lookup without a configured webhook', async () => {
  const ctx=setup({env:{...firebotEnv,FIREBOT_WEBHOOK_SECRET:undefined}}), order=await ctx.api.create(validInput(),'test');
  assert.equal((await ctx.api.status(order.token)).status,'PENDING'); assert.equal(ctx.gateway.calls.length,1);
  ctx.transaction().status='PAID'; ctx.advance(15000);
  const paid=await ctx.api.status(order.token);
  assert.equal(paid.status,'COMPLETED');assert.equal(paid.redirect,'/obrigado?origem=checkout');
  assert.equal(ctx.gateway.calls[1].url,`https://firebotbr.com/api/v1/pix/${ctx.transaction().transactionId}`);
  await ctx.api.status(order.token);assert.equal(ctx.gateway.calls.length,2);
});
test('FireBot status polling validates identity, total, method, currency and explicit paid status', async () => {
  for(const change of [{transactionId:'fire_tx_different'},{amount:5},{amount:null},{currency:'USD'},{paymentMethod:'CREDIT_CARD'},{status:'SUCCESS'},{status:'PENDING'}]) {
    const ctx=setup(),order=await ctx.api.create(validInput(),'test');Object.assign(ctx.transaction(),{status:'PAID',...change});ctx.advance(15000);
    assert.equal((await ctx.api.status(order.token)).redirect,null);
  }
});
test('FireBot throttles concurrent authenticated checks and rejects forged order tokens', async () => {
  const ctx=setup(),order=await ctx.api.create(validInput(),'test');
  await assert.rejects(()=>ctx.api.status(order.token+'x'),/inválido/);
  ctx.advance(15000);await Promise.all([ctx.api.status(order.token),ctx.api.status(order.token),ctx.api.status(order.token)]);
  assert.equal(ctx.gateway.calls.filter(c=>c.options.method==='GET').length,1);
  await ctx.api.status(order.token);assert.equal(ctx.gateway.calls.length,2);
});
test('FireBot verifies HMAC over the exact raw body before processing paid events', async () => {
  const ctx=setup(),order=await ctx.api.create(validInput(),'test'),event=firebotEvent(ctx.transaction());
  await assert.rejects(()=>ctx.api.webhook(event.raw,'0'.repeat(64)),/inválida/);
  await assert.rejects(()=>ctx.api.webhook(event.raw+' ',event.signature),/inválida/);
  assert.equal((await ctx.api.status(order.token)).status,'PENDING');
  await ctx.api.webhook(event.raw,event.signature);await ctx.api.webhook(event.raw,event.signature);
  assert.equal((await ctx.api.status(order.token)).redirect,'/obrigado?origem=checkout');
});
test('FireBot signed but mismatched notifications cannot complete an order', async () => {
  for(const change of [{amount:5},{amount:null},{paymentMethod:'WITHDRAWAL'},{currency:'USD'},{status:'PENDING'}]) {
    const ctx=setup(),order=await ctx.api.create(validInput(),'test');
    const raw=JSON.stringify({event:'venda.paga',data:{...ctx.transaction(),status:'PAID',...change}});
    await assert.rejects(()=>ctx.api.webhook(raw,digest(firebotEnv.FIREBOT_WEBHOOK_SECRET,raw)),/divergente/);
    assert.equal((await ctx.api.status(order.token)).redirect,null);
  }
});
test('FireBot late notifications cannot undo refunds or confirmed purchases', async () => {
  const ctx=setup(),order=await ctx.api.create(validInput(),'test'),paid=firebotEvent(ctx.transaction()),refund=firebotEvent(ctx.transaction(),'venda.estornada');
  await ctx.api.webhook(paid.raw,paid.signature);
  const pending=JSON.stringify({event:'venda.pendente',data:ctx.transaction()});await ctx.api.webhook(pending,digest(firebotEnv.FIREBOT_WEBHOOK_SECRET,pending));
  assert.equal((await ctx.api.status(order.token)).status,'COMPLETED');
  await ctx.api.webhook(refund.raw,refund.signature);await ctx.api.webhook(paid.raw,paid.signature);
  assert.equal((await ctx.api.status(order.token)).status,'REFUNDED');assert.equal((await ctx.api.status(order.token)).redirect,null);
});
test('FireBot never creates a second payment after a timeout or accepts an incomplete create response', async () => {
  for(const mode of ['timeout','partial','wrong-amount','failed','invalid-json']) {
    let calls=0;
    const ctx=setup({fetcher:async()=>{calls++;if(mode==='timeout')throw new DOMException('private details','TimeoutError');if(mode==='invalid-json')return new Response('<html>private details</html>');
      return Response.json({success:true,transactionId:'fire_tx_localtest12345',amount:mode==='wrong-amount'?5:6,status:mode==='failed'?'FAILED':'PENDING',...(mode!=='partial'?{pixCopiaECola:'LOCAL_TEST_ONLY_NOT_A_PAYMENT'}:{})});}});
    const input=validInput(),order=await ctx.api.create(input,'test');
    assert.equal(order.status,'REVIEW');assert.equal(order.pix,null);
    await ctx.api.create(input,'test');assert.equal(calls,1);
    assert.ok(!JSON.stringify(ctx.logs).includes('private details'));
  }
});
test('FireBot preserves the copyable code if local QR rendering fails', async () => {
  const code='LOCAL_TEST_ONLY_'.repeat(1000);
  const ctx=setup({fetcher:async()=>Response.json({success:true,transactionId:'fire_tx_testfallback123',amount:6,status:'PENDING',pixCopiaECola:code})});
  const order=await ctx.api.create(validInput(),'test');
  assert.equal(order.pix.code,code);assert.equal(order.pix.image,null);assert.equal(order.status,'PENDING');
});
test('FireBot missing credentials and missing webhook secret fail closed', async () => {
  const ctx=setup({env:{}});assert.equal(ctx.api.ready(),false);await assert.rejects(()=>ctx.api.create(validInput(),'test'),/indisponível/);assert.equal(ctx.store.data.size,0);
  const next=setup({env:{...firebotEnv,FIREBOT_WEBHOOK_SECRET:undefined}});await assert.rejects(()=>next.api.webhook('{}','0'.repeat(64)),/não configuradas/);
});
test('FireBot server rate limit persists across instances', async () => {
  const ctx=setup();for(let i=0;i<6;i++)await ctx.api.create(validInput(),'test');
  const second=makeFirebotPayments({store:ctx.store,env:firebotEnv,fetcher:ctx.gateway.fetcher});
  await assert.rejects(()=>second.create(validInput(),'test'),/Muitas tentativas/);assert.equal(ctx.gateway.calls.length,6);
});

test('authorized Imersão test permits exactly one extra charge without relaxing the general limit', async () => {
  const ctx=setup();ctx.advance(Date.parse('2026-11-11T23:30:00Z')-Date.now());
  for(let i=0;i<6;i++)await ctx.api.create(validInput(),'test');
  const testInput=()=>({...validInput('imersao'),buyer:{name:'Teste Tecnico Checkout',email:'checkout-test@example.com',phone:'11999998888',document:'11144477735'},confirmEmail:'checkout-test@example.com'});
  await assert.rejects(()=>ctx.api.create({...testInput(),product:'pos'},'test'),/Muitas tentativas/);
  await assert.rejects(()=>ctx.api.create({...testInput(),buyer:{...testInput().buyer,name:'Outro Nome'}},'test'),/Muitas tentativas/);
  const input=testInput(),order=await ctx.api.create(input,'test');assert.equal(order.amount,6);assert.equal(order.status,'PENDING');
  assert.equal((await ctx.api.create(input,'test')).orderId,order.orderId);
  await assert.rejects(()=>ctx.api.create(testInput(),'test'),/Muitas tentativas/);
  for(let i=0;i<6;i++)await ctx.api.create(validInput(),'another-ip');
  await assert.rejects(()=>ctx.api.create(testInput(),'another-ip'),/Muitas tentativas/);
  assert.equal(ctx.gateway.calls.length,13);
});

test('the temporary Imersão test grant expires and cannot be reused later', async()=>{
  const ctx=setup();ctx.advance(Date.parse('2026-11-12T04:30:00Z')-Date.now());
  for(let i=0;i<6;i++)await ctx.api.create(validInput(),'test');
  const input={...validInput('imersao'),buyer:{name:'Teste Tecnico Checkout',email:'checkout-test@example.com',phone:'11999998888',document:'11144477735'},confirmEmail:'checkout-test@example.com'};
  await assert.rejects(()=>ctx.api.create(input,'test'),/Muitas tentativas/);
  assert.equal(ctx.gateway.calls.length,6);
});
test('a slow FireBot lookup cannot undo a concurrent signed refund', async () => {
  const ctx=setup();let resolveLookup,started;const waiting=new Promise(r=>{started=r;});
  const api=makeFirebotPayments({store:ctx.store,env:firebotEnv,now:()=>Date.now()+20000,logger:{},fetcher:async()=>{started();return new Promise(r=>{resolveLookup=r;});}});
  const order=await ctx.api.create(validInput(),'test'),query=api.status(order.token);await waiting;
  const refund=firebotEvent(ctx.transaction(),'venda.estornada');await ctx.api.webhook(refund.raw,refund.signature);
  resolveLookup(Response.json({success:true,...ctx.transaction(),status:'PAID'}));
  assert.equal((await query).status,'REFUNDED');
});
