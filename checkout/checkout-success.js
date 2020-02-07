
/**
  * `checkout-success`
  *
  * 
  *   Success overlay presented after payment completion.
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
import {schedule} from '@longlost/utils/utils.js';
import htmlString from './checkout-success.html';
import logo       from 'images/manifest/icon.png';
import '@longlost/app-overlays/app-overlay.js';
import '@longlost/app-icons/app-icons.js';
import '@longlost/responsive-image/responsive-image.js';
import '@polymer/iron-icon/iron-icon.js';


class CheckoutSuccess extends AppElement {
  static get is() { return 'checkout-success'; }
  
  static get template() {
    return html([htmlString]);
  }
      

  static get properties() {
    return {

      _email: String,

      _logo: Object,

      _message: String

    };
  }


  connectedCallback() {
    super.connectedCallback();

    this._logo = logo;
  }


  async open(email, message = 'We appreciate your business.') {
    this._email   = email;
    this._message = message;
    this.style.display = 'block';
    await schedule();
    return this.$.overlay.open();
  }


  async __overlayClicked() {
    try {
      await this.clicked();
      this.fire('success-closing');
      await schedule();
      await this.$.overlay.close();
      this.style.display = 'none';
    }
    catch (error) {
      if (error === 'click debounced') { return; }
      console.error(error);
    }
  }

}

window.customElements.define(CheckoutSuccess.is, CheckoutSuccess);
