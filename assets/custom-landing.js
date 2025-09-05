/* Custom Landing JS (vanilla) – Quick View + Add to Cart + auto-add rule + mobile friendly */
(function(){
  const grid = document.querySelector('[id^="custom-grid-"]');
  if(!grid) return;

  const modal = grid.querySelector('[data-quick-modal]');
  const modalContent = grid.querySelector('[data-modal-content]');

  const parseJSON = (s)=>{ try{ return JSON.parse(s); } catch(e){ return null; } };
  const htmlDecode = (str)=>{ const t=document.createElement('textarea'); t.innerHTML=str||''; return t.value; };

  async function fetchProduct(handle){
    try{
      const res = await fetch(`/products/${encodeURIComponent(handle)}.js`,{headers:{'Accept':'application/json'}});
      if(!res.ok) throw new Error('fetch failed');
      return await res.json();
    }catch(e){ return null; }
  }

  // Open modal from any product card (event delegation for performance)
  grid.addEventListener('click', async (e)=>{
    const trigger = e.target.closest('[data-quick-view]');
    const close = e.target.closest('[data-close]');
    if(close){ modal.close ? modal.close() : modal.removeAttribute('open'); return; }
    if(!trigger) return;

    const raw = trigger.getAttribute('data-product-json') || '';
    const embedded = parseJSON(raw) || parseJSON(htmlDecode(raw));
    const handle = trigger.getAttribute('data-product-handle');

    // Prefer canonical product JSON from /products/handle.js (stable shape for variants/prices)
    const product = (handle ? await fetchProduct(handle) : null) || embedded;
    if(!product) return;

    renderQuickView(product);
    if(typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open','');
  });

  function money(cents){
    const val = Number(cents||0)/100;
    const currency = (window.Shopify && Shopify.currency && Shopify.currency.active) ? Shopify.currency.active : 'USD';
    try{ return new Intl.NumberFormat(undefined,{ style:'currency', currency}).format(val); }
    catch(e){ return `$${val.toFixed(2)}`; }
  }

  function renderQuickView(product){
    // Build option selectors and variant map (using option1/2/3 to be robust)
    const optionNames = product.options || []; // e.g., ["Color","Size"]
    const variants = product.variants || [];

    const variantMap = new Map();
    variants.forEach(v=>{
      const parts = [];
      if(optionNames.length>0) parts.push(v.option1);
      if(optionNames.length>1) parts.push(v.option2);
      if(optionNames.length>2) parts.push(v.option3);
      variantMap.set(parts.join(' / ').toLowerCase(), v);
    });

    const img = (product.images && product.images[0]) ? product.images[0] : null;

    // Build selects from variants (unique values per option index)
    const optionsHTML = optionNames.map((name, idx)=>{
      const values = Array.from(new Set(variants.map(v=> v[`option${idx+1}`]))).filter(Boolean);
      const id = `opt-${idx}`;
      return `
        <label class="c-label">${name}
          <select class="c-select" data-opt data-index="${idx}" id="${id}">
            ${values.map(v => `<option value="${v}">${v}</option>`).join('')}
          </select>
        </label>
      `;
    }).join('');

    // Pick a sensible default: first available variant (or first variant)
    const defaultVariant = variants.find(v=> v.available) || variants[0];

    modalContent.innerHTML = `
      <div class="c-qv__media">${ img ? `<img src="${img}" alt="${product.title||''}">` : '' }</div>
      <div class="c-qv__body">
        <h2 class="c-qv__title">${product.title || ''}</h2>
        <p class="c-qv__price" data-price>${money(defaultVariant?.price || product.price)}</p>
        ${product.description || product.body_html ? `<div class="c-qv__desc">${product.description || product.body_html}</div>` : ''}
        <div class="c-qv__options">${optionsHTML}</div>
        <div class="c-qv__actions">
          <input type="number" min="1" value="1" class="c-qty" data-qty>
          <button class="c-btn" data-add>ADD TO CART</button>
          <span class="c-msg" aria-live="polite"></span>
        </div>
      </div>
    `;

    const selects = [...modalContent.querySelectorAll('[data-opt]')];
    const qtyInput = modalContent.querySelector('[data-qty]');
    const btnAdd = modalContent.querySelector('[data-add]');
    const msg = modalContent.querySelector('.c-msg');
    const priceEl = modalContent.querySelector('[data-price]');

    // Initialize selects to the defaultVariant's values
    if(defaultVariant){
      selects.forEach((s, idx)=>{ const v = defaultVariant[`option${idx+1}`]; if(v) s.value = v; });
      if(priceEl) priceEl.textContent = money(defaultVariant.price);
    }

    function currentKey(){ return selects.map((s,idx)=> s.value).join(' / ').toLowerCase(); }

    function getSelectedVariant(){
      return variantMap.get(currentKey()) || variants.find(v=>v.available) || variants[0];
    }

    // Update price when options change
    selects.forEach(s=> s.addEventListener('change', ()=>{
      const v = getSelectedVariant();
      if(priceEl && v) priceEl.textContent = money(v.price);
    }));

    btnAdd.addEventListener('click', async ()=>{
      const v = getSelectedVariant();
      const qty = Math.max(1, parseInt(qtyInput.value||'1',10));
      msg.textContent = 'Adding…';
      try{
        if(!v || !v.id) throw new Error('No variant selected');
        await addToCart(v.id, qty);
        await maybeAutoAddBonus(v);
        msg.textContent = 'Added to cart!';
      }catch(err){
        console.error(err);
        msg.textContent = (err && err.message) ? String(err.message) : 'Error adding to cart';
      }
    });
  }

  async function addToCart(variantId, quantity){
    const res = await fetch('/cart/add.js',{
      method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({ id: variantId, quantity })
    });
    if(!res.ok){
      const text = await res.text();
      try{ const j = JSON.parse(text); if(j && j.description) throw new Error(j.description); }catch(_){}
      throw new Error(text || 'Add to cart failed');
    }
    return res.json();
  }

  async function getCart(){ const r = await fetch('/cart.js'); return r.json(); }

  async function maybeAutoAddBonus(selectedVariant){
    const opts = [selectedVariant?.option1, selectedVariant?.option2, selectedVariant?.option3].map(o=> String(o||'').toLowerCase());
    if(!(opts.includes('black') && opts.includes('medium'))) return;

    const bonusId = grid.getAttribute('data-bonus-variant-id');
    if(!bonusId) return;

    try{
      const cart = await getCart();
      if(cart.items.some(it => String(it.id) === String(bonusId))) return;
    }catch(e){ /* non-fatal */ }

    await addToCart(Number(bonusId), 1);
  }
})();