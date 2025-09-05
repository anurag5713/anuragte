/* Custom Landing (vanilla) – Quick View + Add to Cart + auto-add rule + a11y + redirect toggle */
(function(){
  const grid = document.querySelector('[id^="custom-grid-"]');
  if(!grid) return;

  // Elements
  const modal = grid.querySelector('[data-quick-modal]');
  const modalContent = grid.querySelector('[data-modal-content]');

  // Utils
  const money = (cents)=>{
    const val = Number(cents || 0) / 100;
    const cur = (window.Shopify && Shopify.currency && Shopify.currency.active) ? Shopify.currency.active : 'USD';
    try { return new Intl.NumberFormat(undefined, {style:'currency', currency:cur}).format(val); }
    catch { return `$${val.toFixed(2)}`; }
  };

  const fetchProduct = async (handle)=>{
    try{
      const res = await fetch(`/products/${encodeURIComponent(handle)}.js`, {headers:{'Accept':'application/json'}});
      if(!res.ok) throw new Error('fetch failed');
      return await res.json();
    }catch(e){ return null; }
  };

  const addToCart = async (variantId, quantity)=>{
    const r = await fetch('/cart/add.js', {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body: JSON.stringify({ id: variantId, quantity })
    });
    if(!r.ok){
      const t = await r.text();
      try { const j = JSON.parse(t); if(j && j.description) throw new Error(j.description); } catch(_){}
      throw new Error(t || 'Add to cart failed');
    }
    return r.json();
  };

  const getCart = async ()=> (await fetch('/cart.js')).json();

  // Modal a11y
  let lastFocus = null;
  function openModal(){
    lastFocus = document.activeElement;
    if(typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open','');
    const closeBtn = modal.querySelector('.c-modal__close');
    closeBtn && closeBtn.focus();
  }
  function closeModal(){
    if(typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
    lastFocus && lastFocus.focus();
  }
  modal.addEventListener('click', (e)=>{
    if(e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && modal.hasAttribute('open')) closeModal();
  });

  // Open Quick View (delegated)
  grid.addEventListener('click', async (e)=>{
    const trigger = e.target.closest('[data-quick-view]');
    if(!trigger) return;
    const handle = trigger.getAttribute('data-product-handle');
    const product = handle ? await fetchProduct(handle) : null;
    if(!product) return;
    renderQuickView(product);
    openModal();
  });

  function renderQuickView(product){
    const optionNames = product.options || [];
    const variants    = product.variants || [];
    const images      = product.images || [];
    const img         = images[0] || null;

    // Unique values per option index
    const valuesFor = (idx)=> Array.from(new Set(variants.map(v => v[`option${idx+1}`]).filter(Boolean)));

    const optionsHTML = optionNames.map((name, idx)=>{
      const values = valuesFor(idx);
      const id = `opt-${idx}`;
      return `
        <label class="c-label">${name}
          <select class="c-select" data-opt data-index="${idx}" id="${id}">
            ${values.map(v => `<option value="${v}">${v}</option>`).join('')}
          </select>
        </label>
      `;
    }).join('');

    const defaultVariant = variants.find(v => v.available) || variants[0];

    modalContent.innerHTML = `
      <div class="c-qv__media">${ img ? `<img src="${img}" alt="${product.title || ''}">` : '' }</div>
      <div class="c-qv__body">
        <h2 class="c-qv__title">${product.title || ''}</h2>
        <p class="c-qv__price" data-price>${money(defaultVariant?.price || product.price)}</p>
        ${product.description ? `<div class="c-qv__desc">${product.description}</div>` : ''}
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
    const btnAdd   = modalContent.querySelector('[data-add]');
    const msg      = modalContent.querySelector('.c-msg');
    const priceEl  = modalContent.querySelector('[data-price]');

    // Initialize selects to defaultVariant
    if(defaultVariant){
      selects.forEach((s, idx)=>{
        const v = defaultVariant[`option${idx+1}`];
        if(v) s.value = v;
      });
      priceEl && (priceEl.textContent = money(defaultVariant.price));
    }

    const selectedValues = ()=> selects.map((s)=> s.value);
    const findVariant = (vals)=> variants.find(v =>
      optionNames.every((_,i)=> String(vals[i]||'') === String(v[`option${i+1}`]||''))
    );

    function syncVariantFromUI(){
      const vals = selectedValues();
      let v = findVariant(vals) || variants.find(v => v.available) || variants[0];
      if(v){
        selects.forEach((s, idx)=>{ const vv = v[`option${idx+1}`]; if(vv) s.value = vv; });
        priceEl && (priceEl.textContent = money(v.price));
      }
      return v;
    }

    selects.forEach(s => s.addEventListener('change', syncVariantFromUI));

    btnAdd.addEventListener('click', async ()=>{
      const v = syncVariantFromUI();
      const qty = Math.max(1, parseInt(qtyInput.value || '1', 10));
      if(!v || !v.id){ msg.textContent = 'No variant available'; return; }

      msg.textContent = 'Adding…'; btnAdd.disabled = true;
      try{
        await addToCart(v.id, qty);
        await maybeAutoAddBonus(v);
        msg.textContent = 'Added to cart!';
        const shouldRedirect = grid.getAttribute('data-redirect') === 'true';
        if(shouldRedirect){ window.location.href = '/cart'; return; }
      }catch(err){
        console.error(err);
        msg.textContent = (err && err.message) ? String(err.message) : 'Error adding to cart';
      }finally{
        btnAdd.disabled = false;
      }
    });
  }

  async function maybeAutoAddBonus(selectedVariant){
    const opts = [selectedVariant?.option1, selectedVariant?.option2, selectedVariant?.option3]
      .map(o => String(o||'').toLowerCase());
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
