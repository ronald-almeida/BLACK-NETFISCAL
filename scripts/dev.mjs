import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { makePayments } from '../lib/payments.js';
import { memoryStore, fakeEnv, fakeGateway, paidEvent } from '../tests/fixtures.mjs';
const mock = process.argv.includes('--mock');
const testStore = memoryStore();
const payments = mock ? makePayments({store:testStore,env:fakeEnv,fetcher:fakeGateway().fetcher}) : null;
const root = resolve('public');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.pdf':'application/pdf'};
http.createServer(async(req,res)=>{
  try {
    const url = new URL(req.url,'http://127.0.0.1:3000');
    if(url.pathname.startsWith('/api/') || (mock && url.pathname==='/__test__/paid')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);
      let response;
      if(mock){
        const input=raw.length?JSON.parse(raw):{};
        if(url.pathname==='/api/checkout')response=Response.json(req.method==='GET'?{available:true}:await payments.create(input,'local'));
        else if(url.pathname==='/api/order-status')response=Response.json(await payments.status(input.token));
        else if(url.pathname==='/__test__/paid') {
          const record = await testStore.read(`orders/${input.orderId}`);
          response=Response.json(await payments.webhook(paidEvent({orderId:input.orderId,amount:record.data.amount})));
        }
        else response=new Response('Not found',{status:404});
      } else {
        const names={'/api/checkout':'checkout','/api/order-status':'order-status','/api/pix-webhook':'pix-webhook'};
        if(!names[url.pathname]){res.writeHead(404);res.end();return;}
        const handler=(await import(`../api/${names[url.pathname]}.js`))[req.method];
        response=handler?await handler(new Request(url,{method:req.method,headers:req.headers,...(raw.length?{body:raw}:{} )})):new Response('Method not allowed',{status:405});
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    let path=url.pathname==='/'?'/index.html':url.pathname==='/obrigado'?'/obrigado.html':/^\/checkout\/(mba|pos|imersao)$/.test(url.pathname)?'/checkout.html':url.pathname;
    const file=resolve(root,`.${decodeURIComponent(path)}`);if(!file.startsWith(root+'\\')&&!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.status?error.message:'Erro no servidor local.',fields:error.fields||{}}));}
}).listen(3000,'127.0.0.1',()=>console.log(`http://127.0.0.1:3000 — ${mock?'LOCAL MOCK: no real payments':'development'}`));
