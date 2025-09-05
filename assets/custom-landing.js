/* Custom Landing JS (vanilla) – Quick View + Add to Cart + auto-add rule + mobile friendly */
(function(){
  const grid = document.querySelector('[id^="custom-grid-"]');
  if(!grid) return;

  const modal = grid.querySelector('[data-quick-modal]');
  const modalContent = grid.querySelector('[data-modal-content]');

  const parseJSON = (s)=>{ try{ return JSON.parse(s); } catch(e){ return null; } };
  const htmlDecode = (str)=>{ const t=document.createElement('textarea'); t.innerHTML=str||''; return t.value; };

  // Open modal from any product card (event delegation for performance)
  grid.addEventListener('click', (e)=>{
    const trigger = e.target.closest('[data-quick-view]');
    const close = e.target.closest('[data-close]');
    if(close){ modal.close ? modal.close() : modal.removeAttribute('open'); return; }
    if(!trigger) return;

    const raw = trigger.getAttribute('data-product-json') || '';
    const product = parseJSON(raw) || parseJSON(htmlDecode(raw));
    if(!product) return;

    renderQuickView(product);
    if(typeof modal.showModal === 'function') modal.showModal(); else modal.setAttribute('open','');
  });

  function money(cents){
    const val = Number(cents||0)/100;
    const currency = (window.Shopify && Shopify.currency && Shopify.currency.active) ? Shopify.currency.active : 'USD';
    try{
      return new Intl.NumberFormat(undefined,{ style:'currency', currency}).format(val);
    }catch(e){ return `$${val.toFixed(2)}`; }
  }

  function renderQuickView(product){
    // Build option selectors and variant map
    const variantMap = new Map();
    (product.variants||[]).forEach(v=>{ variantMap.set((v.options||[]).join(' / ').toLowerCase(), v); });

    const img = (product.images && product.images[0]) ? product.images[0] : null;

    const optionsHTML = (product.options || []).map((opt, idx)=>{
      const values = Array.from(new Set((product.variants||[]).map(v=> v.options[idx])));
      const id = `opt-${idx}`;
      return `
        <label class="c-label">${opt.name}
          <select class="c-select" data-opt data-index="${idx}" id="${id}">
            ${values.map(v => `<option value="${v}">${v}</option>`).join('')}
          </select>
        </label>
      `;
    }).join('');

    const priceCents = product.price ?? (product.variants && product.variants[0] && product.variants[0].price);

    modalContent.innerHTML = `
      <div class="c-qv__media">${ img ? `<img src="${img}" alt="${product.title}">` : '' }</div>
      <div class="c-qv__body">
        <h2 class="c-qv__title">${product.title || ''}</h2>
        <p class="c-qv__price">${money(priceCents)}</p>
        ${product.body_html ? `<div class="c-qv__desc">${product.body_html}</div>` : (product.description ? `<p class="c-qv__desc">${product.description}</p>` : '')}
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

    function currentKey(){ return selects.map(s=> s.value).join(' / ').toLowerCase(); }

    function getSelectedVariant(){
      return variantMap.get(currentKey()) || (product.variants||[]).find(v=>v.available) || (product.variants||[])[0];
    }

    btnAdd.addEventListener('click', async ()=>{
      const v = getSelectedVariant();
      const qty = Math.max(1, parseInt(qtyInput.value||'1',10));
      msg.textContent = 'Adding…';
      try{
        await addToCart(v.id, qty);
        await maybeAutoAddBonus(v);
        msg.textContent = 'Added to cart!';
      }catch(err){
        console.error(err);
        msg.textContent = 'Error adding to cart';
      }
    });
  }

  async function addToCart(variantId, quantity){
    const res = await fetch('/cart/add.js',{
      method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({ id: variantId, quantity })
    });
    if(!res.ok){ throw new Error(await res.text() || 'Add to cart failed'); }
    return res.json();
  }

  async function getCart(){ const r = await fetch('/cart.js'); return r.json(); }

  async function maybeAutoAddBonus(selectedVariant){
    const opts = (selectedVariant?.options || []).map(o=> String(o).toLowerCase());
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