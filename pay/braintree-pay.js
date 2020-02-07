
/**
	*
	*	`braintree-pay`
	*
	*
 	* api
 	*
 	*   open()
 	*
 	*   properties:
 	* 
 	*      order:  required parameters
 	*        email,        (string) for tranactional receipt
 	*        user,         {uid}, (firebase auth) save order to users orders data for future lookup
 	*        items,        callable inventory function items
 	*        rateIds,      callable getRates function rateIds array
 	*        shippingCost, (number) from shippo shipping options
 	*        subtotal,     (number) items sub before shipping and tax
 	*        tax,          from calcPrices in lambda.js
 	*        total         from calcPrices in lambda.js
 	* 
 	*
  * @customElement
  * @polymer
  * @demo demo/index.html
  *
 	**/
 

import {braintreeConfig} from 'app.config.js';
import {
  AppElement, 
  html
}                        from '@longlost/app-element/app-element.js';
import {
  listen,
  schedule, 
  // topLevelOverlayController,
  unlisten,
  wait,
  warn
}                        from '@longlost/utils/utils.js';
import services          from '@longlost/services/services.js';
import dropin            from 'braintree-web-drop-in';
import htmlString        from './braintree-pay.html';
import '@longlost/app-overlays/app-modal.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/paper-spinner/paper-spinner-lite.js';
import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-checkbox/paper-checkbox.js';
import '@polymer/iron-icon/iron-icon.js';
import './braintree-badge.js';


class CheckoutPay extends AppElement {
  static get is() { return 'braintree-pay'; }

  static get template() {
    return html([htmlString]);
  }
  

  static get properties() {
    return {

      order: Object,
      // used for vault checkbox state
      _braintreeCustomerId: String,
      // braintree-web-drop-in
      _dropinInstance: Object,
      // data passed into 'pay' cloud function
      _orderForPay: {
        type: Object,
        computed: '__computeOrderForPay(order)'
      },


      // topLevelOverlayController('#payOverlay')
      // _payOverlay: Object,

      

      _tooLateToClose: Boolean

    };
  }


  static get observers() {
    return [
      '__userAndBraintreeCustIdChanged(order.user, _braintreeCustomerId)'
    ];
  }


  // connectedCallback() {
  //   super.connectedCallback();



  //   document.body.insertBefore(this.$.payOverlay, null);
  //   this._payOverlay = topLevelOverlayController('#payOverlay', true);


  // }


  __computeOrderForPay(order) {
    if (!order) { return; }
    const {total, user} = order;
    const amount = Number(total).toFixed(2);
    const uid    = user ? user.uid : null;
    return Object.assign({}, order, {amount, uid, user: null});
  }


  __userAndBraintreeCustIdChanged(user, id) {
    if (user) {
      this.$.vaultCheckbox.hidden  = false;
      if (id) {
        this.$.vaultCheckbox.checked = true;
      }
      else {
        this.$.vaultCheckbox.checked = false;
      }
    }
    else {
      this.$.vaultCheckbox.checked = false;
      this.$.vaultCheckbox.hidden  = true;
    }
  }

  
  async __getAuthToken(uid) {
    if (uid) {
      const {braintreeCustomerId} = await services.get({coll: 'users', doc: uid});
      this._braintreeCustomerId   = braintreeCustomerId; // used in vault checkbox logic
      if (!braintreeCustomerId) { return braintreeConfig.authToken; }
      const authToken = await services.cloudFunction({
        name: 'payUserToken', 
        data: {braintreeCustomerId}
      });
      return authToken;
    }
    // allow anonymous users to pay
    return braintreeConfig.authToken;
  }


  __createInstance(token, amount) {

    const getOptions = () => {
      const options = {
        authorization: token, 



        // container:     '#pay-container'


        container: this.$.payContainer


      };

      if (braintreeConfig.paypal) {
        Object.assign(options, {
          paypal: {
            flow:     'checkout',
            amount,
            currency: 'USD'
          },
          paypalCredit: {
            flow:     'checkout',
            amount,
            currency: 'USD'
          }
        });
      }
      if (braintreeConfig.applePay) {
        Object.assign(options, {
          applePay: {
            displayName: braintreeConfig.applePay.displayName,
            paymentRequest: {
              total: {
                label: braintreeConfig.applePay.label,
                amount
              }
            }
          }
        });
      }
      if (braintreeConfig.googleMerchantId) {
        Object.assign(options, {
          googlePay: {
            merchantId: braintreeConfig.googleMerchantId, 
            transactionInfo: {
              totalPriceStatus: 'FINAL',
              totalPrice:        amount,
              currencyCode:     'USD'
            }
          }
        });
      }

      return options;
    };

    return dropin.create(getOptions());
  }


  async __create(uid, amount) {
    const authToken      = await this.__getAuthToken(uid);
    this._dropinInstance = await this.__createInstance(authToken, amount);
  }


  async __tearDown() {
    if (this._dropinInstance) {
      this._dropinInstance.clearSelectedPaymentMethod();
      await this._dropinInstance.teardown();
      this._dropinInstance = undefined;
    }
  }


  async __resetPay() {
    await this.__tearDown();
    this.$.payCardTitle.innerText   = '';
    this.$.paySpinnerText.innerText = '';
  }


  async __exit() {
    this.__canClose();
    // await this._payOverlay.close();

    await this.$.modal.close();


    this.fire('pay-modal-exit');
    return this.__resetPay();
  }


  async __showPayOverlay(element) {
    element.style.display = 'flex';
    await schedule();
    element.style.opacity = '1';
    return wait(200);
  }


  async __hidePayOverlay(element) {
    element.style.opacity = '0';
    await wait(200);
    element.style.display = 'none';
  }


  __showSpinner(str) {
    if (str) {
      this.$.paySpinnerText.innerText = str;
    }
    this.$.paySpinner.active = true;
    return this.__showPayOverlay(this.$.paySpinnerContainer);
  }


  async __hideSpinner() {
    await this.__hidePayOverlay(this.$.paySpinnerContainer);
    this.$.paySpinner.active = false;
  }


  __disablePayBtn() {
    const alwaysDisabled = () => this.$.payBtn.disabled = true;
    this._dropinInstance.on('paymentMethodRequestable',   alwaysDisabled);
    this._dropinInstance.on('noPaymentMethodRequestable', alwaysDisabled);    
    alwaysDisabled();
  }


  __disableBtns() {
    this.$.vaultCheckbox.disabled = true;
    this.$.exitPayBtn.disabled    = true;
  }


  __enableBtns() {
    this.$.vaultCheckbox.disabled = false;
    this.$.exitPayBtn.disabled    = false;
  }


  __handlePayBtnDisabledState() {
    if (this._dropinInstance.isPaymentMethodRequestable()) {
      // This will be true if you generated the client token
      // with a customer ID and there is a saved payment method
      // available to tokenize with that customer.
      this.$.payBtn.disabled = false;
    }
    this._dropinInstance.on(
      'paymentMethodRequestable', 
      () => this.$.payBtn.disabled = false
    );
    this._dropinInstance.on(
      'noPaymentMethodRequestable', 
      () => this.$.payBtn.disabled = true
    );
  }


  __tooLateToClose() {
    this._tooLateToClose = true;
    this.fire('pay-too-late-to-close', {tooLate: true});
  }


  __canClose() {
    this._tooLateToClose = false;
    this.fire('pay-too-late-to-close', {tooLate: false});
  }


  async __savePayMethodsBtnClicked() {
    const {checked}     = this.$.vaultCheckbox;
    const {amount, uid} = this._orderForPay;
    this.__disableBtns();
    if (checked) {
      await this.__showSpinner('Creating secure vault.');
      await this.__tearDown();
      await services.cloudFunction({name: 'addUserPayVault'});
    }
    else {
      await this.__showSpinner('Destroying vault.');  
      await this.__tearDown();    
      await services.cloudFunction({name: 'deleteUserPayVault'});      
    }
    await this.__create(uid, amount);
    this.__handlePayBtnDisabledState();
    await wait(500);
    await this.__hideSpinner();
    this.__enableBtns();
  }
  // test card# 4111 1111 1111 1111
  // 4111111111111111
  async __payButtonClicked() {
    try {
      await this.clicked();
      this.__tooLateToClose();
      this.__disablePayBtn();
      this.__disableBtns();
      await this.__showSpinner('Processing');
      this.$.dummyInput.focus(); // ios fix to hide keyboard
      await schedule();
      this.$.dummyInput.blur();  // ios fix to hide keyboard
      const payload = await this._dropinInstance.requestPaymentMethod();
      const {email} = this._orderForPay;
      const date    = new Date(Date.now()).toLocaleString();
      const data    = Object.assign(
        {}, 
        this._orderForPay, 
        {date, nonce: payload.nonce}
      );
      const response = await services.cloudFunction({name: 'pay', data});
      // success: Boolean, transaction: Braintree Transaction Result Object
      // transaction.status: "authorized", "processor_declined" or "settlement_declined"
      const {success, transaction} = response; 
      if (success) {
        const confirmationCode        = transaction.processorAuthorizationCode;




        const confirmationElement     = document.querySelector('#pay-confirmation-number');
        confirmationElement.innerText = `Confirmation: ${confirmationCode}`;





        await this.__showPayOverlay(this.$.paySuccessMessage);
        const detail = {
          confirmationCode, 
          email, 
          transactionId: transaction.id
        };
        this.fire('pay-success', detail);
      }
      else {
        await this.__showPayOverlay(this.$.payDeclinedMessage);
        this._dropinInstance.clearSelectedPaymentMethod();        
      }
    }
    catch (error) {
      const {code} = error;
      if (code && code === 'invalid-argument') {
        // show an error message that encourages them to try one more time
        // sync changes before retrying
        await warn('Sorry, a price or availablility change occured while processing your payment. You have not been charged.');
        this.fire('pay-open-sync');
      }
      else {
        if (!window.navigator.onLine) {
          await warn('Please check your internet connection.');
        }
        else {
          await warn('Sorry, unexpected error occured. You have not been charged.');
        }
      } 
      await this.__exit();      
    }
    finally {
      this.__canClose();
      this.__enableBtns();
      this.__hideSpinner();
    }
  }


  async __successButtonClicked() {
    await this.__exit();
    this.__hidePayOverlay(this.$.paySuccessMessage);
  }


  async __declinedButtonClicked() {
    await this.__hidePayOverlay(this.$.payDeclinedMessage);
    this.__handlePayBtnDisabledState();
  }


  async __exitPayButtonClicked() {
    try {
      await this.clicked();
      this.__exit();
    }
    catch (error) {
      console.log('pay exit error: ', error);
    }
  }


  __scrollToTop() {
    return new Promise(resolve => {
      listen(window, 'scroll', (_, key) => {
        window.requestAnimationFrame(() => {
          if (window.scrollY !== 0) { return; }
          unlisten(key);
          resolve();
        });
      });
      window.scrollTo({top: 0, behavior: 'smooth'});
    });
  }


  async open() {
    const {email, total, user} = this.order;
    if (!total) { throw new Error('pay must have a total'); }
    if (!email) { throw new Error('pay must have an email address to send a receipt email'); }
    try {
      const amount = Number(total).toFixed(2);
      const uid    = user ? user.uid : null;
      this.$.payCardTitle.innerText = `Total $${amount}`;
      this.__showSpinner();
      await schedule();


      // await this._payOverlay.open();
      await this.$.modal.open();




      await schedule();
      await this.__scrollToTop();
      await this.__create(uid, amount);
      this.__handlePayBtnDisabledState();
      await wait(500);
      this.__hideSpinner();
    }
    catch (error) {
      this.__exit();
      console.error(error);
    }
  }


  async close() {
    if (this._tooLateToClose) { return; }
    await this.__hideSpinner();
    return this.__exit();
  }

}

window.customElements.define(CheckoutPay.is, CheckoutPay);
