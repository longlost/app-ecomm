
/**
  * `checkout-selector`
  *
  * 
  *   Payment and shipping options made available to user.
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
import htmlString from './checkout-selector.html';
import {schedule} from '@longlost/utils/utils.js';
import '@longlost/app-overlays/app-header-overlay.js';
import '@longlost/app-icons/app-icons.js';
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-button/paper-button.js';


class CheckoutSelector extends AppElement {
  static get is() { return 'checkout-selector'; }

  static get template() {
    return html([htmlString]);
  }


  static get properties() {
    return {

      // Hidden attribute in DOM.
      hasShippables: Boolean

    };
  }


  async __selectorBtnClicked(orderType) {
    try {
      await this.clicked();
      this.fire('selector-order-type-selected', {orderType});
    }
    catch (error) { 
      if (error === 'click debounced') { return; }
      console.error(error); 
    }
  }


  __onlinePayShipBtnClicked() {
    this.__selectorBtnClicked('ship');
  }


  __onlinePayInStorePickupBtnClicked() {
    this.__selectorBtnClicked('prepaid');
  }


  __inStorePayPickupBtnClicked() {
    this.__selectorBtnClicked('pickup');
  }


  __onlinePayBtnClicked() {
    this.__selectorBtnClicked('prepaid');
  }


  __inStorePayBtnClicked() {
    this.__selectorBtnClicked('pickup');
  }


  open() {
    return this.$.overlay.open();
  }
  

  reset() {
    return this.$.overlay.reset();
  }

}

window.customElements.define(CheckoutSelector.is, CheckoutSelector);
