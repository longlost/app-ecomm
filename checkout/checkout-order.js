
/**
  * `checkout-order`
  * 
  *   A receipt like overview of the customer's order.
  *
  *
  *
  *
  * @customElement
  * @polymer
  * @demo demo/index.html
  *
  **/


import {
  privacyPolicyUrl,
  termsOfServiceUrl
}                  from 'app.config.js';
import {
  AppElement, 
  html
}                  from '@longlost/app-element/app-element.js';
import {schedule}  from '@longlost/utils/utils.js';
import htmlString  from './checkout-order.html';
import '@longlost/app-overlays/app-header-overlay.js';
import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-checkbox/paper-checkbox.js';


class CheckoutOrder extends AppElement {
  static get is() { return 'checkout-order'; }

  static get template() {
    return html([htmlString]);
  }
  

  static get properties() {
    return {

      order: Object,

      _hideCredit: {
        type: Boolean,
        computed: '__computeHideCredit(order.credit)'
      },

      _hideShipping: {
        type: Boolean,
        computed: '__computeHideShipping(order.shippingCost)'
      },

      // Disabled until user checks the privacy and terms checkbox.
      _orderBtnDisabled: {
        type: Boolean,
        value: true
      },

      // Privacy policy url for paper-checkbox.
      _privacyUrl: String,

      // Terms of service url for paper-checkbox.
      _termsUrl: String

    };
  }


  connectedCallback() {
    super.connectedCallback();

    this._privacyUrl = privacyPolicyUrl;
    this._termsUrl   = termsOfServiceUrl;
  }


  __computeHideShipping(num) {
    return num === undefined ? true : false;
  }


  __computeHideCredit(str) {
    return str === undefined || str === '0.00' ? true : false;
  }


  __computeFormattedShippingCost(num) {
    return num === 0 ? 'Free Shipping' : `$${num}`;
  }

  // Privacy and terms checkbox on-checked-changed handler.
  // User has agreed to privacy policy and terms of service.
  __privacyTermsCheckedChanged(event) {

    // Enable order button when checkbox is checked.
    this._orderBtnDisabled = !event.detail.value;
  }


  async __placeOrderButtonClicked() {
    try {
      await this.clicked();
      this.fire('order-place-order-btn-clicked');
    }
    catch (error) { 
      if (error === 'click debounced') { return; }
      console.error('__placeOrderButtonClicked error: ', error); 
    }
  }
  

  async close() {
    await this.$.overlay.close();
    this.style.display = 'none';
  }


  async open() {
    this.style.display = 'block';
    await schedule();
    return this.$.overlay.open();
  }
  

  reset() {
    this.$.overlay.reset();
    this.style.display = 'none';
  }

}

window.customElements.define(CheckoutOrder.is, CheckoutOrder);
