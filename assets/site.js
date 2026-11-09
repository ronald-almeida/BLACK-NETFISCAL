'use strict';

// Selecionar o produto e seguir diretamente para seu checkout.
(function () {
  const dialog = document.getElementById('pre');
  const form = document.getElementById('pre-form');
  const options = document.getElementById('opts');
  const error = document.getElementById('product-error');
  const submit = form.querySelector('button[type="submit"]');
  let trigger = null;

  function resetFeedback() {
    error.hidden = true;
    options.removeAttribute('aria-invalid');
    form.classList.remove('sent');
    submit.disabled = false;
  }

  function open(product, button) {
    trigger = button;
    form.reset();
    resetFeedback();
    form.querySelectorAll('input[name="produto"]').forEach(function (input) {
      input.checked = input.value === product;
    });
    dialog.showModal();
    document.documentElement.classList.add('pre-open');
    const first = form.querySelector('input:checked') || form.querySelector('input');
    first.focus({ preventScroll: true });
  }

  document.querySelectorAll('[data-open-pre]').forEach(function (button) {
    button.addEventListener('click', function () {
      open(button.dataset.produto || '', button);
    });
  });

  dialog.querySelector('[data-close-pre]').addEventListener('click', function () {
    dialog.close();
  });
  dialog.addEventListener('click', function (event) {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', function () {
    document.documentElement.classList.remove('pre-open');
    if (trigger) trigger.focus({ preventScroll: true });
  });
  options.addEventListener('change', resetFeedback);
  window.addEventListener('pageshow', resetFeedback);

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const product = form.querySelector('input[name="produto"]:checked');
    if (!product) {
      error.textContent = 'Selecione um produto para continuar.';
      error.hidden = false;
      options.setAttribute('aria-invalid', 'true');
      options.querySelector('input').focus();
      return;
    }

    const destination = window.CHECKOUT_LINKS && window.CHECKOUT_LINKS[product.value];
    try {
      const url = new URL(destination);
      if (url.protocol !== 'https:') throw new Error('Checkout inválido');
      submit.disabled = true;
      form.classList.add('sent');
      window.location.assign(url.href);
    } catch (exception) {
      submit.disabled = false;
      form.classList.remove('sent');
      error.textContent = 'Não foi possível abrir o pagamento. Tente novamente em instantes.';
      error.hidden = false;
    }
  });
})();
// ===== Barra fixa no mobile: aparece depois do hero e some perto do rodapé =====
(function(){
  var bar = document.getElementById('sticky'), hero = document.getElementById('topo'), foot = document.querySelector('footer');
  if (!bar || !('IntersectionObserver' in window)) return;
  var inHero = true, inFoot = false;
  function upd(){ bar.classList.toggle('show', !inHero && !inFoot); }
  new IntersectionObserver(function(e){ inHero = e[0].isIntersecting; upd(); }).observe(hero);
  new IntersectionObserver(function(e){ inFoot = e[0].isIntersecting; upd(); }).observe(foot);
})();

// ===== Números crescentes (uma vez, ao entrar na tela) =====
(function(){
  var els = document.querySelectorAll('[data-count]');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fmt(el, v){ el.textContent = (el.dataset.prefix||'') + Math.round(v).toLocaleString('pt-BR'); }
  function run(el){
    var end = +el.dataset.count, dur = 1600, t0 = null;
    if (reduce){ fmt(el,end); return; }
    function step(t){ if (t0===null) t0 = t; var k = Math.min(1,(t-t0)/dur), e = 1-Math.pow(1-k,4); fmt(el, end*e); if (k<1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }
  if (!('IntersectionObserver' in window)) return;
  els.forEach(function(el){ fmt(el,0); });
  var io = new IntersectionObserver(function(entries){ entries.forEach(function(en){ if (en.isIntersecting){ run(en.target); io.unobserve(en.target); } }); },{threshold:.6});
  els.forEach(function(el){ io.observe(el); });
})();

// ===== Bônus: revelar ao rolar, empilhar no mobile, luz que segue o mouse =====
(function(){
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var els = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduce){
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){
        if (!e.isIntersecting) return;
        var n = e.target; n.classList.add('is-in'); io.unobserve(n);
        setTimeout(function(){ n.removeAttribute('data-reveal'); n.classList.remove('is-in'); }, 1500);
      });
    },{rootMargin:'0px 0px -8% 0px',threshold:.12});
    els.forEach(function(el){ io.observe(el); });
  } else els.forEach(function(el){ el.removeAttribute('data-reveal'); });

  var mq = window.matchMedia('(max-width: 999px)');
  var stacks = [].map.call(document.querySelectorAll('[data-stack]'), function(g){ return [].slice.call(g.children); });
  if (stacks.length && !reduce){
    var raf = 0;
    var tall = function(){ var h = innerHeight - 28; stacks.forEach(function(c){ c.forEach(function(n){ n.classList.toggle('is-tall', n.offsetHeight > h); }); }); };
    var upd = function(){
      raf = 0; if (!mq.matches) return;
      stacks.forEach(function(c){
        var r = c.map(function(n){ return n.getBoundingClientRect(); });
        c.forEach(function(n,i){
          var p = 0;
          if (i < c.length-1){ var h = n.offsetHeight || 1; p = Math.min(1, Math.max(0, (r[i].top + h - r[i+1].top) / h)); }
          n.style.setProperty('--p', p.toFixed(3));
        });
      });
    };
    var kick = function(){ if (!raf) raf = requestAnimationFrame(upd); };
    var all = function(){ tall(); kick(); };
    addEventListener('scroll', kick, {passive:true}); addEventListener('resize', all); addEventListener('load', all); all();
  }

  var fine = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1000px)');
  document.querySelectorAll('[data-glow] > *').forEach(function(c){
    var x=0,y=0,t=0;
    var f = function(){ t=0; var r=c.getBoundingClientRect(); c.style.setProperty('--mx',(x-r.left)+'px'); c.style.setProperty('--my',(y-r.top)+'px'); };
    c.addEventListener('pointermove', function(e){ if (!fine.matches) return; x=e.clientX; y=e.clientY; if(!t) t=requestAnimationFrame(f); });
  });
})();

// ===== Passos: no celular o número acende conforme a rolagem =====
(function(){
  var steps = document.querySelectorAll('.step');
  if (!steps.length || !('IntersectionObserver' in window)) return;
  if (!window.matchMedia('(max-width: 860px), (hover: none)').matches) return;
  var io = new IntersectionObserver(function(es){
    es.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add('lit'); io.unobserve(e.target); } });
  },{rootMargin:'0px 0px -42% 0px'});
  steps.forEach(function(s){ io.observe(s); });
})();
