
/**
	*
	*	`braintree-badge`
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
  braintreeConfig
}                 from 'app.config.js';
import {
  AppElement, 
  html
}                 from '@longlost/app-element/app-element.js';
import {
  isOnScreen,
  schedule
}                 from '@longlost/utils/utils.js';
import htmlString from './braintree-badge.html';
import '@polymer/iron-image/iron-image.js';


class BraintreeBadge extends AppElement {
  static get is() { return 'braintree-badge'; }

  static get template() {
    return html([htmlString]);
  }


  static get properties() {
    return {

      _merchantId: String,

      _src: String
      
    };
  }


  connectedCallback() {
    super.connectedCallback();

    this.__lazyLoad();
  }


  __computeHref(id) {
    if (!id) { return ''; }
    return `https://www.braintreegateway.com/merchants/${id}/verified`;
  }


  async __lazyLoad() {
    await schedule();
    await isOnScreen(this);
    const {merchantId} = braintreeConfig || {};
    this._merchantId   = merchantId      || '';
    this._src          = merchantId      ? 
      'https://s3.amazonaws.com/braintree-badges/braintree-badge-wide-light.png' : '#';
  }

}

window.customElements.define(BraintreeBadge.is, BraintreeBadge);
