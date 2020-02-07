
/**
	*
	*	`app-cart`
	*
	*
 	*
  * @customElement
  * @polymer
  * @demo demo/index.html
  *
 	**/
 

import {
  AppElement, 
  html
}                 from '@longlost/app-element/app-element.js';
import {
  currency
}                 from '@longlost/lambda/lambda.js';
import {
  listen,
  unlisten
}                 from '@longlost/utils/utils.js';
import htmlString from './app-cart.html';
import '@longlost/app-overlays/app-header-overlay.js';
import '@polymer/paper-button/paper-button.js';
import '../pay/braintree-badge.js';


class AppCart extends AppElement {
  static get is() { return 'app-cart'; }

  static get template() {
    return html([htmlString]);
  }


  static get properties() {
    return {

      buttonText: {
        type: String,
        value: 'Checkout'
      },

      disabled: Boolean,

      emptyCartWords: Array,

      subtotal: Number,

      title: {
        type: String,
        value: 'My Cart'
      },

      _items: Array,

      _resetListenerKey: Object,

      _slotListenerKey: Object,

      _subtotal: {
        type: Object,
        computed: '__computeSubtotal(subtotal)'
      },

      _deletePayload: Object,

      _unsubscribe: Object
      
    };
  }


  connectedCallback() {
    super.connectedCallback();

    this._resetListenerKey = listen(
      this.$.overlay, 
      'overlay-reset', 
      this.__reset.bind(this)
    );

    this._slotListenerKey = listen(
      this.$.slot,
      'slotchange',
      this.__slotChangedHandler.bind(this)
    );
  }


  disconnectedCallback() {
    super.disconnectedCallback();

    unlisten(this._resetListenerKey);
    unlisten(this._slotListenerKey);
  }


  __computeHiddenFlavorText(items) {
    if (!items) { return; }
    return items.length === 0 ? 'show' : '';
  }

  // Items passed to change words between cart.
  __computeFlavorTextWords(words, items) {
    return words[Math.floor(Math.random() * words.length)];
  }

  
  __computeSubtotal(subtotal) {
    return currency(subtotal);
  }


  __computePricingClass(subtotal) {
    return subtotal === '0.00' ? '' : 'show-subtotal';
  }

 
  __computeCheckoutButtonDisabled(subtotal, disabled) {
    return Boolean(subtotal === '0.00') || disabled;
  }


  __reset() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = undefined;
    }
  }


  __slotChangedHandler() {
    const nodes = this.slotNodes('#slot');

    this._items = nodes.filter(node => 
      node.tagName !== undefined && node.tagName !== 'DOM-REPEAT');

    this.__resetAnimation(this._items);
  }

  // Transitions lower items when item is removed from cart.
  __resetAnimation(items) {
    this.$.belowRepeaterContent.style.transition = 'none';
    this.$.belowRepeaterContent.style.transform  = 'none';

    if (items && items.length) {
      items.forEach(item => {
        item.style.transition = 'none';
        item.style.transform  = '';
      });
    }

    // Correct for a slight blip in height if this is 
    // not reset after each animation sequence.
    const {height} = this.getBoundingClientRect();
    this.style.minHeight = `${height}px`;
  }

  // Listener in <app-main>. Deletes a item in cart.
  __belowRepeaterContentTransitionend(event) {
    if (event.propertyName !== 'transform') { return; }
    if (this._deletePayload === undefined)  { return; }

    this.fire('cart-item-deleted', this._deletePayload);
    this._deletePayload = undefined;
  }


  deleteItem(payload) {
    const {animationIndex} = payload;
    const {height}         = this._items[animationIndex].getBoundingClientRect();
    const remainingItems   = this._items.slice(animationIndex + 1);
    this._deletePayload    = payload;    
    this.$.belowRepeaterContent.style.transform  = `translateY(${-height}px)`;

    if (remainingItems.length) {
      remainingItems.forEach((item, index) => {
        const delay = index ? index / 20 : 0; // Cascaded effect.
        item.style.transition = `transform 0.3s var(--custom-ease) ${delay}s`;
        item.style.transform  = `translateY(${-height}px)`;
      });
      const finalDelay = remainingItems.length / 20; // Cascaded effect.
      this.$.belowRepeaterContent.style.transition = `transform 0.3s var(--custom-ease) ${finalDelay}s`;
    } 
    else {
      this.$.belowRepeaterContent.style.transition = 'transform 0.3s var(--custom-ease)';
    }
  }


  async __continueShoppingButtonClicked(event) {
    try {
      await this.clicked();
      this.$.overlay.close();
    }
    catch (error) { 
      if (error === 'click debounced') { return; }
      console.error('__continueShoppingButtonClicked error: ', error); 
    }
  }


  async __checkoutButtonClicked() {
    try {
      await this.clicked();
      this.fire('cart-checkout-button-clicked', {subtotal: this._subtotal});
    }
    catch (error) {
      if (error === 'click debounced') { return; }
      console.error('__checkoutButtonClicked error', error);
    }
  }


  open() {
    return this.$.overlay.open();
  }


  reset() {
    this.__reset();
    return this.$.overlay.reset();
  }

}

window.customElements.define(AppCart.is, AppCart);
